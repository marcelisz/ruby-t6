require "cgi"

class BoardThumbnail
  WIDTH = 640
  HEIGHT = 400
  ASPECT_RATIO = WIDTH.to_f / HEIGHT
  MIN_VIEW_WIDTH = 900.0
  MIN_VIEW_HEIGHT = MIN_VIEW_WIDTH / ASPECT_RATIO
  PADDING = 160.0

  def initialize(board)
    @board = board
    @elements = board.elements.order(:id).to_a
    @theme = board.theme_details
  end

  def render
    <<~SVG
      <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="#{view_box.join(' ')}" role="img" aria-label="#{escape(@board.name)} preview">
        <defs>
          <pattern id="dot-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.7" fill="#{@theme[:dots]}" opacity="0.72"/>
          </pattern>
          <filter id="note-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#352B20" flood-opacity="0.16"/>
          </filter>
          <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#352B20" flood-opacity="0.12"/>
          </filter>
        </defs>
        <rect x="#{view_box[0]}" y="#{view_box[1]}" width="#{view_box[2]}" height="#{view_box[3]}" fill="#{@theme[:background]}"/>
        <rect x="#{view_box[0]}" y="#{view_box[1]}" width="#{view_box[2]}" height="#{view_box[3]}" fill="url(#dot-grid)"/>
        #{render_elements}
        #{render_empty_mark}
      </svg>
    SVG
  end

  private

  def view_box
    @view_box ||= begin
      if @elements.empty?
        [ -MIN_VIEW_WIDTH / 2, -MIN_VIEW_HEIGHT / 2, MIN_VIEW_WIDTH, MIN_VIEW_HEIGHT ]
      else
        content = content_bounds
        center_x = (content[0] + content[2]) / 2.0
        center_y = (content[1] + content[3]) / 2.0
        content_width = [ content[2] - content[0], 1.0 ].max
        content_height = [ content[3] - content[1], 1.0 ].max

        width = [ content_width + PADDING * 2, MIN_VIEW_WIDTH ].max
        height = [ content_height + PADDING * 2, MIN_VIEW_HEIGHT ].max

        if width / height > ASPECT_RATIO
          height = width / ASPECT_RATIO
        else
          width = height * ASPECT_RATIO
        end

        [
          (center_x - width / 2.0).round(2),
          (center_y - height / 2.0).round(2),
          width.round(2),
          height.round(2)
        ]
      end
    end
  end

  def content_bounds
    bounds = @elements.filter_map(&:bounds)
    return [ 0, 0, 0, 0 ] if bounds.empty?

    [
      bounds.map { |box| box[0] }.min,
      bounds.map { |box| box[1] }.min,
      bounds.map { |box| box[2] }.max,
      bounds.map { |box| box[3] }.max
    ]
  end

  def render_elements
    @elements.map { |element| render_element(element) }.compact.join("\n")
  end

  def render_element(element)
    data = element.payload || {}
    width = element.width.to_f

    case element.kind
    when "pen", "highlighter", "eraser"
      render_freehand(element, data, width)
    when "rectangle"
      render_rectangle(element, data, width)
    when "ellipse"
      render_ellipse(element, data, width)
    when "line", "arrow"
      render_line(element, data, width)
    when "note"
      render_note(element, data)
    when "text"
      render_text(element, data)
    end
  end

  def render_freehand(element, data, width)
    points = Array(data["points"])
    return if points.empty?

    path = smooth_path(points)
    stroke_color =
      case element.kind
      when "eraser" then @theme[:background]
      else element.color
      end

    opacity = element.kind == "highlighter" ? 0.34 : 1
    stroke_width =
      case element.kind
      when "highlighter" then width * 4
      when "eraser" then width * 3.5
      else width
      end

    %(<path d="#{path}" fill="none" stroke="#{stroke_color}" stroke-width="#{stroke_width.round(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="#{opacity}"/>)
  end

  def render_rectangle(element, data, width)
    x, y, w, h = normalized_box(data)
    radius = [ [ w, h ].min * 0.08, 18 ].min
    %(<rect x="#{x}" y="#{y}" width="#{w}" height="#{h}" rx="#{radius.round(2)}" fill="none" stroke="#{element.color}" stroke-width="#{width}" stroke-linejoin="round"/>)
  end

  def render_ellipse(element, data, width)
    x, y, w, h = normalized_box(data)
    %(<ellipse cx="#{(x + w / 2).round(2)}" cy="#{(y + h / 2).round(2)}" rx="#{(w / 2).round(2)}" ry="#{(h / 2).round(2)}" fill="none" stroke="#{element.color}" stroke-width="#{width}"/>)
  end

  def render_line(element, data, width)
    x1 = data["x1"].to_f
    y1 = data["y1"].to_f
    x2 = data["x2"].to_f
    y2 = data["y2"].to_f
    line = %(<line x1="#{x1}" y1="#{y1}" x2="#{x2}" y2="#{y2}" stroke="#{element.color}" stroke-width="#{width}" stroke-linecap="round"/>)
    return line unless element.kind == "arrow"

    angle = Math.atan2(y2 - y1, x2 - x1)
    head = [ 18 + width * 2.4, 20 ].max
    spread = Math::PI / 7.0
    p1 = [ x2 - head * Math.cos(angle - spread), y2 - head * Math.sin(angle - spread) ]
    p2 = [ x2 - head * Math.cos(angle + spread), y2 - head * Math.sin(angle + spread) ]
    polygon = %(<polygon points="#{x2},#{y2} #{p1[0].round(2)},#{p1[1].round(2)} #{p2[0].round(2)},#{p2[1].round(2)}" fill="#{element.color}"/>)
    line + polygon
  end

  def render_note(element, data)
    x = data["x"].to_f
    y = data["y"].to_f
    w = data["w"].to_f
    h = data["h"].to_f
    text = data["text"].to_s
    font_size = 18.0
    line_height = font_size * 1.32
    author = element.nickname.to_s

    lines = wrap_lines(text, max_chars_for(w, font_size, 36), max_lines_for(h, font_size, 76))
    author_y = y + 27
    text_y = y + 58

    parts = []
    parts << %(<g filter="url(#note-shadow)">)
    parts << %(<rect x="#{x}" y="#{y}" width="#{w}" height="#{h}" rx="9" fill="#{element.color}"/>)
    parts << %(<rect x="#{x + 14}" y="#{y + 14}" width="28" height="4" rx="2" fill="#2B2118" opacity="0.16"/>)
    parts << %(<text x="#{x + 16}" y="#{author_y}" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="0.5" fill="#2B2118" opacity="0.55">#{escape(author.upcase)}</text>)
    parts << %(<text x="#{x + 16}" y="#{text_y}" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="#{font_size}" font-weight="500" fill="#282018">)
    lines.each_with_index do |line, index|
      parts << %(<tspan x="#{x + 16}" dy="#{index.zero? ? 0 : line_height}">#{escape(line)}</tspan>)
    end
    parts << %(</text></g>)
    parts.join
  end

  def render_text(element, data)
    x = data["x"].to_f
    y = data["y"].to_f
    font_size = data["font_size"].to_f.nonzero? || 32.0
    max_width = data["max_width"].to_f.nonzero? || 560.0
    line_height = font_size * 1.32
    lines = wrap_lines(data["text"].to_s, max_chars_for(max_width, font_size, 0), 80)

    parts = []
    parts << %(<text x="#{x}" y="#{y + font_size}" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="#{font_size}" font-weight="600" fill="#{element.color}">)
    lines.each_with_index do |line, index|
      parts << %(<tspan x="#{x}" dy="#{index.zero? ? 0 : line_height}">#{escape(line)}</tspan>)
    end
    parts << %(</text>)
    parts.join
  end

  def render_empty_mark
    return "" unless @elements.empty?

    box = view_box
    translate_x = box[0] + box[2] / 2.0 - 115
    translate_y = box[1] + box[3] / 2.0 - 30
    <<~SVG
      <g opacity="0.42" transform="translate(#{translate_x} #{translate_y})">
        <path d="M12 46c10-38 41-44 59-25 17 18 3 39-18 34-24-6-10-31 23-32 28-1 43 16 37 34" fill="none" stroke="#{@theme[:dots]}" stroke-width="8" stroke-linecap="round"/>
        <circle cx="118" cy="51" r="8" fill="#{@theme[:dots]}"/>
      </g>
    SVG
  end

  def normalized_box(data)
    x = data["x"].to_f
    y = data["y"].to_f
    w = data["w"].to_f.abs
    h = data["h"].to_f.abs
    [ x.round(2), y.round(2), [ w, 1 ].max.round(2), [ h, 1 ].max.round(2) ]
  end

  def smooth_path(points)
    sampled = points.each_slice([ (points.size / 600.0).ceil, 1 ].max).map(&:first)
    sampled = points if sampled.empty?

    if sampled.size == 1
      x, y = sampled.first[0].to_f, sampled.first[1].to_f
      return "M #{x - 0.1} #{y} l 0.2 0"
    end

    path = +"M #{format_number(sampled[0][0])} #{format_number(sampled[0][1])}"
    if sampled.size == 2
      path << " L #{format_number(sampled[1][0])} #{format_number(sampled[1][1])}"
      return path
    end

    (1...sampled.size - 1).each do |index|
      current = sampled[index]
      upcoming = sampled[index + 1]
      mid_x = (current[0].to_f + upcoming[0].to_f) / 2.0
      mid_y = (current[1].to_f + upcoming[1].to_f) / 2.0
      path << " Q #{format_number(current[0])} #{format_number(current[1])} #{format_number(mid_x)} #{format_number(mid_y)}"
    end
    last = sampled.last
    path << " T #{format_number(last[0])} #{format_number(last[1])}"
    path
  end

  def max_chars_for(width, font_size, horizontal_padding)
    usable = [ width - horizontal_padding, font_size * 3 ].max
    [ (usable / (font_size * 0.54)).floor, 8 ].max
  end

  def max_lines_for(height, font_size, vertical_offset)
    [ ((height - vertical_offset) / (font_size * 1.32)).floor, 1 ].max
  end

  def wrap_lines(text, max_chars, max_lines)
    lines = []
    text.to_s.each_line do |paragraph|
      words = paragraph.strip.split(/\s+/)
      if words.empty?
        lines << ""
        next
      end

      current = +""
      words.each do |word|
        candidate = current.empty? ? word : "#{current} #{word}"
        if candidate.length <= max_chars
          current = candidate
        else
          lines << current unless current.empty?
          current = word
        end
      end
      lines << current unless current.empty?
    end
    lines = [ "" ] if lines.empty?
    lines = lines.first(max_lines)
    last = lines.last
    lines[-1] = "#{last.to_s[0, [ max_chars - 1, 1 ].max]}…" if last && last.length > max_chars
    lines
  end

  def format_number(value)
    value.to_f.round(2).to_s
  end

  def escape(value)
    CGI.escapeHTML(value.to_s)
  end
end
