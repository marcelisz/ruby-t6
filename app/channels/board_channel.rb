class BoardChannel < ApplicationCable::Channel
  CLIENT_ID_FORMAT = /\A[a-zA-Z0-9_-]{8,64}\z/
  CLIENT_UID_FORMAT = /\A[a-zA-Z0-9_-]{8,64}\z/
  TEMP_ID_FORMAT = /\A[a-zA-Z0-9_-]{4,80}\z/

  def subscribed
    @board = Board.find_by(id: params[:board_id])
    return reject unless @board

    @client_id = sanitize_identifier(params[:client_id], CLIENT_ID_FORMAT)
    @nickname = UserIdentity.normalize(params[:nickname])
    return reject if @client_id.blank? || @nickname.blank?

    @session_id = SecureRandom.uuid
    @color = UserIdentity.color_for(@nickname)

    stream_for @board
    BoardPresence.join(@board.id, @session_id, nickname: @nickname, color: @color)

    transmit({
      type: "welcome",
      session_id: @session_id,
      nickname: @nickname,
      color: @color,
      initials: UserIdentity.initials_for(@nickname),
      board_id: @board.id,
      server_time: Time.current.iso8601
    })

    last_id = params[:last_element_id].to_i
    missed_elements = @board.elements.where("id > ?", last_id).map(&:editor_json)
    transmit({ type: "sync", elements: missed_elements }) if missed_elements.any?

    broadcast_presence
  end

  def unsubscribed
    return unless @board && @session_id

    BoardPresence.leave(@board.id, @session_id)
    broadcast_presence
    self.class.broadcast_to(@board, {
      type: "cursor_gone",
      sender_session_id: @session_id
    })
  end

  def cursor(data)
    safely(data) { handle_cursor(data) }
  end

  def cursor_leave(data)
    safely(data) { handle_cursor_leave }
  end

  def live(data)
    safely(data) { handle_live(data) }
  end

  def live_cancel(data)
    safely(data) { handle_live_cancel(data) }
  end

  def commit(data)
    safely(data) { handle_commit(data) }
  end

  def delete(data)
    safely(data) { handle_delete(data) }
  end

  def erase(data)
    safely(data) { handle_erase(data) }
  end

  def rename_board(data)
    safely(data) { handle_rename(data) }
  end

  def ping(data = nil)
    safely(data) { transmit({ type: "pong", at: Time.current.iso8601 }) }
  end

  private

  def safely(data)
    yield
  rescue ElementSanitizer::InvalidElement => e
    transmit_error(e.message, data.is_a?(Hash) ? data["temp_id"] : nil)
  rescue StandardError => e
    Rails.logger.error("[BoardChannel] #{e.class}: #{e.message}\n#{e.backtrace&.first(8)&.join("\n")}")
    transmit_error("The change could not be saved. Please try again.", data.is_a?(Hash) ? data["temp_id"] : nil)
  end

  def handle_cursor(data)
    x = finite_coordinate(data["x"])
    y = finite_coordinate(data["y"])
    return unless x && y

    self.class.broadcast_to(@board, {
      type: "cursor",
      sender_session_id: @session_id,
      nickname: @nickname,
      color: @color,
      initials: UserIdentity.initials_for(@nickname),
      x: x,
      y: y
    })
  end

  def handle_cursor_leave
    self.class.broadcast_to(@board, {
      type: "cursor_gone",
      sender_session_id: @session_id
    })
  end

  def handle_live(data)
    temp_id = sanitize_identifier(data["temp_id"], TEMP_ID_FORMAT)
    return if temp_id.blank?

    element = ElementSanitizer.new(data["element"]).call
    self.class.broadcast_to(@board, {
      type: "live",
      temp_id: temp_id,
      sender_session_id: @session_id,
      element: element.merge(nickname: @nickname, author_color: @color)
    })
  end

  def handle_live_cancel(data)
    temp_id = sanitize_identifier(data["temp_id"], TEMP_ID_FORMAT)
    return if temp_id.blank?

    self.class.broadcast_to(@board, {
      type: "live_cancel",
      temp_id: temp_id,
      sender_session_id: @session_id
    })
  end

  def handle_commit(data)
    attrs = ElementSanitizer.new(data["element"]).call
    client_uid = sanitize_identifier(data["client_uid"], CLIENT_UID_FORMAT)
    raise ElementSanitizer::InvalidElement, "The drawing identifier is invalid" if client_uid.blank?

    existing = @board.elements.find_by(client_uid: client_uid)
    if existing
      raise ElementSanitizer::InvalidElement, "That drawing identifier is already in use" unless existing.client_id == @client_id

      transmit({ type: "element_created", element: existing.editor_json, temp_id: data["temp_id"] })
      return
    end

    element = @board.elements.build(
      attrs.merge(
        client_id: @client_id,
        client_uid: client_uid,
        nickname: @nickname
      )
    )

    element.save!
    self.class.broadcast_to(@board, {
      type: "element_created",
      element: element.editor_json,
      temp_id: data["temp_id"],
      sender_session_id: @session_id
    })
  end

  def handle_delete(data)
    client_uid = sanitize_identifier(data["client_uid"], CLIENT_UID_FORMAT)
    raise ElementSanitizer::InvalidElement, "The drawing identifier is invalid" if client_uid.blank?

    element = @board.elements.find_by(client_uid: client_uid, client_id: @client_id)
    unless element
      transmit({ type: "delete_failed", client_uid: client_uid, message: "That stroke can no longer be removed." })
      return
    end

    removed = { id: element.id, client_uid: element.client_uid }
    element.destroy!
    self.class.broadcast_to(@board, {
      type: "element_deleted",
      element: removed,
      sender_session_id: @session_id
    })
  end

  def handle_erase(data)
    client_uid = sanitize_identifier(data["client_uid"], CLIENT_UID_FORMAT)
    raise ElementSanitizer::InvalidElement, "The drawing identifier is invalid" if client_uid.blank?

    element = @board.elements.find_by(client_uid: client_uid)
    return unless element && %w[note text].include?(element.kind)

    removed = { id: element.id, client_uid: element.client_uid, kind: element.kind }
    element.destroy!
    self.class.broadcast_to(@board, {
      type: "element_deleted",
      element: removed,
      sender_session_id: @session_id
    })
  end

  def handle_rename(data)
    name = data["name"].to_s.encode("UTF-8", invalid: :replace, undef: :replace)
               .gsub(/[\u0000-\u001F\u007F]/, " ")
               .gsub(/\s+/, " ")
               .strip
               .first(80)

    if name.blank?
      transmit({ type: "rename_failed", message: "A board needs a name." })
      return
    end

    @board.update!(name: name)
    self.class.broadcast_to(@board, {
      type: "board_renamed",
      name: name,
      sender_session_id: @session_id
    })
  end

  def broadcast_presence
    self.class.broadcast_to(@board, {
      type: "presence",
      participants: BoardPresence.participants(@board.id)
    })
  end

  def transmit_error(message, temp_id = nil)
    transmit({ type: "error", message: message, temp_id: temp_id })
  end

  def sanitize_identifier(value, format)
    candidate = value.to_s
    candidate.match?(format) ? candidate : nil
  end

  def finite_coordinate(value)
    number = Float(value)
    return nil unless number.finite?

    [ [ number, -100_000.0 ].max, 100_000.0 ].min
  rescue ArgumentError, TypeError
    nil
  end
end
