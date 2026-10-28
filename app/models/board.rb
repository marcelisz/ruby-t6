class Board < ApplicationRecord
  THEMES = {
    "paper" => {
      name: "Warm paper",
      background: "#FBF7F0",
      dots: "#DED4C4",
      preview: "#F5EBDD"
    },
    "cloud" => {
      name: "Cloud",
      background: "#F6F8FB",
      dots: "#D5DDE8",
      preview: "#E9EEF6"
    },
    "sage" => {
      name: "Sage",
      background: "#F0F6EF",
      dots: "#C9D9C6",
      preview: "#E1ECDE"
    },
    "blush" => {
      name: "Blush",
      background: "#FBF3F0",
      dots: "#E7CFC7",
      preview: "#F4E3DD"
    }
  }.freeze

  DEFAULT_THEME = "paper"

  has_many :elements,
           -> { order(:id) },
           class_name: "BoardElement",
           dependent: :destroy,
           inverse_of: :board

  before_validation :set_defaults, on: :create

  validates :name, presence: true, length: { maximum: 80 }
  validates :creator_nickname, presence: true, length: { maximum: 32 }
  validates :theme, inclusion: { in: THEMES.keys }
  validates :elements_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :recent, -> { order(updated_at: :desc) }

  def self.theme_options
    THEMES.map { |key, details| details.merge(key: key) }
  end

  def theme_details
    THEMES.fetch(theme, THEMES[DEFAULT_THEME])
  end

  def background_color
    theme_details[:background]
  end

  def dot_color
    theme_details[:dots]
  end

  def theme_name
    theme_details[:name]
  end

  private

  def set_defaults
    self.theme = DEFAULT_THEME if theme.blank?
    self.theme = DEFAULT_THEME unless THEMES.key?(theme)
    self.last_activity_at ||= Time.current
  end
end
