module ApplicationHelper
  def brand_mark(extra_class: nil)
    classes = [ "brand-mark", extra_class ].compact.join(" ")
    raw(<<~SVG)
      <svg class="#{classes}" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="44" height="44" rx="13" fill="#191521"/>
        <path d="M11.5 29.2c-2.5-7 2.1-14.5 9.8-16.1" stroke="#FF6541" stroke-width="4.4" stroke-linecap="round"/>
        <path d="M20.2 32.2c7.6 1.6 12.6-3.6 12.6-10.9" stroke="#FFC857" stroke-width="4.4" stroke-linecap="round"/>
        <circle cx="29.7" cy="12.1" r="3.3" fill="#9B8CFF"/>
      </svg>
    SVG
  end

  def user_color(nickname)
    UserIdentity.color_for(nickname)
  end

  def user_initials(nickname)
    UserIdentity.initials_for(nickname)
  end

  def board_time(time)
    local = time.in_time_zone
    hour = local.hour % 12
    hour = 12 if hour.zero?
    meridiem = local.hour < 12 ? "AM" : "PM"
    "#{local.strftime('%b')} #{local.day}, #{local.year} \u00B7 #{hour}:#{local.strftime('%M')} #{meridiem}"
  end

  def board_activity(time)
    seconds = [ Time.current - time, 0 ].max
    return "just now" if seconds < 45
    return "#{pluralize((seconds / 60.0).round, 'minute')} ago" if seconds < 3_600
    return "#{pluralize((seconds / 3_600.0).round, 'hour')} ago" if seconds < 86_400
    return "yesterday" if seconds < 172_800

    "#{(seconds / 86_400.0).round} days ago"
  end

  def first_name(nickname)
    UserIdentity.normalize(nickname).split(/\s+/).first.to_s
  end

  def avatar_style(nickname)
    "--avatar-color: #{user_color(nickname)};"
  end

  def theme_swatch_style(theme)
    "background: #{theme[:background]}; border-color: #{theme[:dots]};"
  end

  def board_json_for_script(value)
    json_escape(value.to_json).html_safe
  end

  def page_title(title = nil)
    base = "Tandem \u2014 a shared canvas for teams"
    title.present? ? "#{title} \u00B7 Tandem" : base
  end

  def nav_link_class(active)
    base = "app-nav__link"
    active ? "#{base} is-active" : base
  end

  def empty_boards?
    @boards.blank?
  end
end
