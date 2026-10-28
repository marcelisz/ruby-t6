class BoardElement < ApplicationRecord
  KINDS = %w[pen highlighter eraser rectangle ellipse line arrow note text].freeze

  belongs_to :board, counter_cache: :elements_count

  validates :kind, inclusion: { in: KINDS }
  validates :client_id, presence: true, length: { maximum: 64 }
  validates :client_uid, presence: true,
                         length: { minimum: 8, maximum: 64 },
                         format: { with: /\A[a-zA-Z0-9_-]+\z/ },
                         uniqueness: { scope: :board_id }
  validates :nickname, presence: true, length: { maximum: 32 }
  validates :color, presence: true, format: { with: /\A#[0-9a-fA-F]{6}\z/ }
  validates :width, numericality: { greater_than: 0, less_than_or_equal_to: 72 }
  validate :payload_is_a_hash

  after_commit :refresh_board_activity

  def editor_json
    {
      id: id,
      client_uid: client_uid,
      kind: kind,
      color: color,
      width: width,
      payload: payload,
      nickname: nickname,
      author_color: UserIdentity.color_for(nickname),
      created_at: created_at.iso8601(3)
    }
  end

  def bounds
    data = payload || {}

    case kind
    when "pen", "highlighter", "eraser"
      points = Array(data["points"])
      return nil if points.empty?

      xs = points.map { |point| point[0].to_f }
      ys = points.map { |point| point[1].to_f }
      pad = effective_stroke_width / 2.0 + 4
      [ xs.min - pad, ys.min - pad, xs.max + pad, ys.max + pad ]
    when "rectangle", "ellipse", "note"
      x = data["x"].to_f
      y = data["y"].to_f
      w = data["w"].to_f
      h = data["h"].to_f
      pad = kind == "note" ? 18 : effective_stroke_width + 8
      [ [x, x + w].min - pad, [y, y + h].min - pad, [x, x + w].max + pad, [y, y + h].max + pad ]
    when "line", "arrow"
      x1 = data["x1"].to_f
      y1 = data["y1"].to_f
      x2 = data["x2"].to_f
      y2 = data["y2"].to_f
      pad = effective_stroke_width + 14
      [ [x1, x2].min - pad, [y1, y2].min - pad, [x1, x2].max + pad, [y1, y2].max + pad ]
    when "text"
      font_size = data["font_size"].to_f.nonzero? || 32.0
      text = data["text"].to_s
      lines = text.lines
      width = [ data["max_width"].to_f, 800 ].min
      width = [ width, 240 ].max
      [ data["x"].to_f - 12, data["y"].to_f - font_size, data["x"].to_f + width + 20,
        data["y"].to_f + [ lines.size, 1 ].max * font_size * 1.35 + 12 ]
    end
  end

  def effective_stroke_width
    case kind
    when "highlighter" then width.to_f * 4
    when "eraser" then width.to_f * 3.5
    else width.to_f
    end
  end

  private

  def payload_is_a_hash
    errors.add(:payload, "must be an object") unless payload.is_a?(Hash)
  end

  def refresh_board_activity
    Board.where(id: board_id).update_all(last_activity_at: Time.current, updated_at: Time.current)
  end
end
