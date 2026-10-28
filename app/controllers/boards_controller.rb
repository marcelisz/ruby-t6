class BoardsController < ApplicationController
  before_action :require_nickname, except: [ :index, :thumbnail ]

  def index
    if current_nickname.blank?
      @return_to = session[:return_to].presence
      render :welcome
      return
    end

    @boards = Board.order(updated_at: :desc)
    @total_boards = @boards.size
    @created_this_week = Board.where(created_at: 7.days.ago..).count
  end

  def show
    @board = Board.find(params[:id])
    @elements = @board.elements.order(:id).to_a
    @theme = @board.theme_details
    @last_element_id = @elements.last&.id.to_i
    @participant_count = BoardPresence.count(@board.id) + 1
  end

  def create
    board = Board.new(
      name: normalized_board_name,
      theme: params[:theme],
      creator_nickname: current_nickname
    )

    if board.save
      redirect_to board_path(board), notice: "Your board is ready. Share the link and start drawing."
    else
      redirect_to root_path, alert: board.errors.full_messages.to_sentence
    end
  end

  def destroy
    board = Board.find(params[:id])
    board_name = board.name

    BoardChannel.broadcast_to(board, { type: "board_deleted", board_id: board.id })
    board.destroy!

    redirect_to root_path, notice: "\u201C#{board_name}\u201D was deleted."
  end

  def thumbnail
    board = Board.includes(:elements).find(params[:id])
    svg = BoardThumbnail.new(board).render

    response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    response.headers["X-Content-Type-Options"] = "nosniff"

    send_data svg,
              type: "image/svg+xml",
              disposition: "inline",
              filename: "tandem-board-#{board.id}.svg"
  end

  private

  def normalized_board_name
    raw = params[:name].to_s.encode("UTF-8", invalid: :replace, undef: :replace)
    raw.gsub(/[\u0000-\u001F\u007F]/, " ").gsub(/\s+/, " ").strip.first(80).presence ||
      "Untitled board"
  end
end
