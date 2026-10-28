class ElementSanitizer
  class InvalidElement < StandardError; end

  KINDS = BoardElement::KINDS
  MAX_POINTS = 4_000
  MAX_TEXT = 2_000
  MAX_COORDINATE = 100_000.0
  HEX_COLOR = /\A#[0-9a-fA-F]{6}\z/

  def initialize(raw)
    @raw = raw.respond_to?(:to_h) ? raw.to_h.stringify_keys : {}
  end

  def call
    kind = @raw["kind"].to_s.downcase
    raise InvalidElement, "Unknown drawing element" unless KINDS.include?(kind)

    {
      kind: kind,
      color: sanitize_color(@raw["color"]),
      width: clamp_number(@raw["width"], 1.0, 72.0, default_width_for(kind)).round(2),
      payload: sanitize_payload(kind, @raw["payload"])
    }
  end

  private

  def sanitize_payload(kind, raw_payload)
    payload = raw_payload.respond_to?(:to_h) ? raw_payload.to_h.stringify_keys : {}

    case kind
    when "pen", "highlighter", "eraser"
      sanitize_points(payload)
    when "rectangle", "ellipse"
      sanitize_box(payload)
    when "line", "arrow"
      sanitize_line(payload)
    when "note"
      sanitize_note(payload)
    when "text"
      sanitize_text(payload)
    else
      raise InvalidElement, "Unsupported drawing element"
    end
  end

  def sanitize_points(payload)
    points = payload["points"]
    raise InvalidElement, "Stroke has no points" unless points.is_a?(Array)
    raise InvalidElement, "Stroke is too long" if points.size > MAX_POINTS

    clean = points.filter_map do |point|
      coordinate_pair(point)
    end
    raise InvalidElement, "Stroke has no valid points" if clean.empty?

    { "points" => clean }
  end

  def coordinate_pair(point)
    if point.is_a?(Array)
      x, y = point[0], point[1]
    elsif point.respond_to?(:to_h)
      values = point.to_h.stringify_keys
      x, y = values["x"], values["y"]
    else
      return nil
    end

    x = number(x)
    y = number(y)
    return nil unless x && y

    [ x.round(2), y.round(2) ]
  end

  def sanitize_box(payload)
    {
      "x" => clamp_number(payload["x"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "y" => clamp_number(payload["y"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "w" => clamp_number(payload["w"], 1, 50_000, 1).round(2),
      "h" => clamp_number(payload["h"], 1, 50_000, 1).round(2)
    }
  end

  def sanitize_line(payload)
    %w[x1 y1 x2 y2].each_with_object({}) do |key, result|
      result[key] = clamp_number(payload[key], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2)
    end
  end

  def sanitize_note(payload)
    text = sanitize_text_value(payload["text"], required: true)
    {
      "x" => clamp_number(payload["x"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "y" => clamp_number(payload["y"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "w" => clamp_number(payload["w"], 100, 800, 232).round(2),
      "h" => clamp_number(payload["h"], 80, 800, 180).round(2),
      "text" => text
    }
  end

  def sanitize_text(payload)
    {
      "x" => clamp_number(payload["x"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "y" => clamp_number(payload["y"], -MAX_COORDINATE, MAX_COORDINATE, 0).round(2),
      "text" => sanitize_text_value(payload["text"], required: true),
      "font_size" => clamp_number(payload["font_size"], 14, 96, 32).round(2),
      "max_width" => clamp_number(payload["max_width"], 160, 1_200, 560).round(2)
    }
  end

  def sanitize_text_value(value, required:)
    text = value.to_s.encode("UTF-8", invalid: :replace, undef: :replace)
                .gsub(/\r\n?/, "\n")
                .gsub(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, "")
                .strip
                .first(MAX_TEXT)
    raise InvalidElement, "Text cannot be empty" if required && text.blank?

    text
  end

  def sanitize_color(value)
    color = value.to_s.strip
    return color if color.match?(HEX_COLOR)

    "#1F2937"
  end

  def default_width_for(kind)
    kind == "highlighter" ? 8.0 : 4.0
  end

  def clamp_number(value, min, max, default)
    numeric = number(value)
    return default.to_f unless numeric

    [ [ numeric, min ].max, max ].min
  end

  def number(value)
    numeric = Float(value)
    numeric.finite? ? numeric : nil
  rescue ArgumentError, TypeError
    nil
  end
end
