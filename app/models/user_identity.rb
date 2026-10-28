require "digest"

module UserIdentity
  PALETTE = %w[
    #EF5533
    #6554E8
    #0E8A79
    #D62F72
    #2563EB
    #B45309
    #15803D
    #7C3AED
  ].freeze

  module_function

  def normalize(nickname)
    nickname.to_s.unicode_normalize(:nfkc).gsub(/\s+/, " ").strip.first(32)
  rescue Encoding::CompatibilityError, ArgumentError
    nickname.to_s.strip.first(32)
  end

  def color_for(nickname)
    digest = Digest::SHA256.hexdigest(nickname.to_s.downcase)
    PALETTE[digest[0, 8].to_i(16) % PALETTE.size]
  end

  def initials_for(nickname)
    parts = normalize(nickname).split(/\s+/).reject(&:blank?)
    return "?" if parts.empty?

    if parts.size == 1
      parts.first[0, 2].upcase
    else
      "#{parts.first[0]}#{parts.last[0]}".upcase
    end
  end

  def soft_color_for(nickname)
    color = color_for(nickname)
    "#{color}1A"
  end
end
