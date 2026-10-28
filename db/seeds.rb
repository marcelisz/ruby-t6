require "securerandom"

def seed_element(board, kind:, payload:, color:, width: 4, nickname:, created_at: Time.current)
  board.elements.create!(
    client_id: "seed-client",
    client_uid: "seed-#{SecureRandom.hex(10)}",
    kind: kind,
    color: color,
    width: width,
    payload: payload,
    nickname: nickname,
    created_at: created_at,
    updated_at: created_at
  )
end

def seed_stroke(board, points, color:, width: 4, nickname:, kind: "pen")
  seed_element(
    board,
    kind: kind,
    payload: { "points" => points.map { |x, y| [ x.round(1), y.round(1) ] } },
    color: color,
    width: width,
    nickname: nickname
  )
end

def seed_highlighter(board, from_x, from_y, to_x, to_y, color:, width: 12, nickname:)
  points = []
  30.times do |index|
    progress = index / 29.0
    x = from_x + (to_x - from_x) * progress
    y = from_y + (to_y - from_y) * progress + Math.sin(progress * Math::PI * 3) * 2.4
    points << [ x, y ]
  end
  seed_stroke(board, points, color: color, width: width, nickname: nickname, kind: "highlighter")
end

def seed_line(board, x1, y1, x2, y2, color:, width: 4, nickname:, kind: "arrow")
  seed_element(
    board,
    kind: kind,
    payload: {
      "x1" => x1.round(1),
      "y1" => y1.round(1),
      "x2" => x2.round(1),
      "y2" => y2.round(1)
    },
    color: color,
    width: width,
    nickname: nickname
  )
end

def seed_note(board, x:, y:, w:, h:, text:, color:, nickname:)
  seed_element(
    board,
    kind: "note",
    payload: { "x" => x, "y" => y, "w" => w, "h" => h, "text" => text },
    color: color,
    width: 4,
    nickname: nickname
  )
end

def seed_text(board, x:, y:, text:, color:, font_size:, max_width:, nickname:)
  seed_element(
    board,
    kind: "text",
    payload: {
      "x" => x,
      "y" => y,
      "text" => text,
      "font_size" => font_size,
      "max_width" => max_width
    },
    color: color,
    width: 4,
    nickname: nickname
  )
end

def seed_ellipse(board, x:, y:, w:, h:, color:, width:, nickname:)
  seed_element(
    board,
    kind: "ellipse",
    payload: { "x" => x, "y" => y, "w" => w, "h" => h },
    color: color,
    width: width,
    nickname: nickname
  )
end

def seed_circle(board, center_x, center_y, radius, color:, width:, nickname:, samples: 44)
  points = samples.times.map do |index|
    angle = (index / samples.to_f) * Math::PI * 2
    [ center_x + Math.cos(angle) * radius * (1 + rand(-0.015..0.015)),
      center_y + Math.sin(angle) * radius * (1 + rand(-0.015..0.015)) ]
  end
  seed_stroke(board, points, color: color, width: width, nickname: nickname)
end

if Board.exists?
  puts "Tandem seeds skipped: boards already exist."
else
  # Welcome board
  welcome = Board.create!(
    name: "Welcome to Tandem \u2728",
    theme: "paper",
    creator_nickname: "Tandem Studio",
    created_at: 2.days.ago
  )

  seed_highlighter(welcome, 8, 43, 558, 55, color: "#FFD166", width: 15, nickname: "Maya Chen")
  seed_text(
    welcome,
    x: 0, y: -8,
    text: "Big ideas live here.",
    color: "#191521", font_size: 68, max_width: 780,
    nickname: "Maya Chen"
  )
  seed_text(
    welcome,
    x: 7, y: 100,
    text: "A shared space to think out loud, make a mess,\nand find the good stuff together.",
    color: "#6F665C", font_size: 25, max_width: 760,
    nickname: "Maya Chen"
  )

  seed_stroke(
    welcome,
    [ [ 0, 80 ], [ 64, 71 ], [ 132, 78 ], [ 211, 69 ], [ 300, 75 ], [ 381, 68 ], [ 470, 73 ], [ 542, 67 ] ],
    color: "#FF6541", width: 5, nickname: "Jon Bell"
  )
  seed_line(welcome, 708, 74, 802, 69, color: "#6554E8", width: 4, nickname: "Jon Bell")

  seed_note(
    welcome,
    x: 835, y: 35, w: 260, h: 184,
    text: "Start with the pen.\nYour first mark can be a tiny one.",
    color: "#FFD97D", nickname: "Maya Chen"
  )
  seed_note(
    welcome,
    x: 735, y: 275, w: 286, h: 190,
    text: "Ideas look better\nwhen they are shared.",
    color: "#FFB49F", nickname: "Jon Bell"
  )
  seed_note(
    welcome,
    x: 1085, y: 233, w: 249, h: 188,
    text: "Invite the whole crew.\nOne link is all it takes.",
    color: "#B9E3C8", nickname: "Ada Okafor"
  )

  seed_circle(welcome, 640, 69, 71, color: "#0E8A79", width: 3, nickname: "Ada Okafor")
  seed_circle(welcome, 640, 69, 58, color: "#FFB703", width: 2, nickname: "Ada Okafor")

  seed_text(
    welcome,
    x: 4, y: 342,
    text: "Scroll to roam \u00B7 pinch or Ctrl+scroll to zoom \u00B7 hold Space to pan",
    color: "#948A7D", font_size: 19, max_width: 690,
    nickname: "Ada Okafor"
  )
  seed_stroke(
    welcome,
    [ [ 6, 418 ], [ 100, 408 ], [ 193, 424 ], [ 300, 411 ], [ 402, 422 ], [ 489, 412 ] ],
    color: "#D62F72", width: 3, nickname: "Ada Okafor"
  )
  seed_stroke(
    welcome,
    [ [ 545, 430 ], [ 560, 395 ], [ 575, 430 ], [ 590, 395 ], [ 606, 430 ] ],
    color: "#FFB703", width: 4, nickname: "Tandem Studio"
  )
  seed_text(
    welcome,
    x: 0, y: 505,
    text: "Made for the moments between the meetings.",
    color: "#A49B90", font_size: 20, max_width: 680,
    nickname: "Tandem Studio"
  )

  # Product sprint board
  sprint = Board.create!(
    name: "Sprint 12 \u00B7 product brainstorm",
    theme: "sage",
    creator_nickname: "Jon Bell",
    created_at: 5.days.ago
  )

  seed_highlighter(sprint, 430, 52, 868, 52, color: "#FFD166", width: 18, nickname: "Jon Bell")
  seed_text(
    sprint,
    x: 0, y: 0,
    text: "Sprint 12 \u2014 what if we\u2026",
    color: "#191521", font_size: 54, max_width: 960,
    nickname: "Jon Bell"
  )
  seed_text(
    sprint,
    x: 4, y: 80,
    text: "A wall of wild ideas before we pick the sensible one.",
    color: "#6F665C", font_size: 21, max_width: 800,
    nickname: "Maya Chen"
  )

  seed_note(
    sprint,
    x: 0, y: 155, w: 260, h: 190,
    text: "What if onboarding felt like playing, not studying?",
    color: "#FFD97D", nickname: "Maya Chen"
  )
  seed_note(
    sprint,
    x: 310, y: 130, w: 252, h: 190,
    text: "Ship one tiny bit of magic every week.",
    color: "#B9E3C8", nickname: "Jon Bell"
  )
  seed_note(
    sprint,
    x: 590, y: 170, w: 268, h: 190,
    text: "Invite people in before the ideas are 'ready'.",
    color: "#FFB49F", nickname: "Ada Okafor"
  )
  seed_note(
    sprint,
    x: 900, y: 108, w: 244, h: 180,
    text: "Make the empty state feel like a welcome mat.",
    color: "#BFD9FF", nickname: "Kai Park"
  )

  seed_ellipse(sprint, x: -16, y: 140, w: 292, h: 224, color: "#6554E8", width: 3, nickname: "Ada Okafor")
  seed_circle(sprint, 914, 52, 42, color: "#FFB703", width: 3, nickname: "Kai Park")
  seed_line(sprint, 600, 70, 884, 41, color: "#FF6541", width: 3, nickname: "Maya Chen", kind: "line")

  seed_stroke(
    sprint,
    [ [ 272, 365 ], [ 296, 359 ], [ 319, 371 ] ],
    color: "#D62F72", width: 5, nickname: "Jon Bell"
  )
  seed_text(
    sprint,
    x: 4, y: 432,
    text: "\u2192 Pick one and sketch it. The best one is probably the scrappy one.",
    color: "#5A5148", font_size: 22, max_width: 870,
    nickname: "Ada Okafor"
  )

  # Brand moodboard
  brand = Board.create!(
    name: "Brand refresh \u00B7 moodboard",
    theme: "blush",
    creator_nickname: "Ada Okafor",
    created_at: 9.days.ago
  )

  seed_text(
    brand,
    x: 0, y: 0,
    text: "Brand refresh",
    color: "#191521", font_size: 62, max_width: 700,
    nickname: "Ada Okafor"
  )
  seed_text(
    brand,
    x: 5, y: 78,
    text: "How should we feel when we open the product?",
    color: "#6F665C", font_size: 23, max_width: 780,
    nickname: "Ada Okafor"
  )
  seed_circle(brand, 785, 58, 48, color: "#D62F72", width: 3, nickname: "Maya Chen")
  seed_circle(brand, 785, 58, 35, color: "#FFB703", width: 2, nickname: "Maya Chen")

  seed_note(
    brand,
    x: 0, y: 170, w: 230, h: 205,
    text: "Warm, human, a little unexpected.",
    color: "#FFD97D", nickname: "Maya Chen"
  )
  seed_note(
    brand,
    x: 285, y: 145, w: 250, h: 220,
    text: "Less corporate. More campfire.",
    color: "#D8CCFF", nickname: "Ada Okafor"
  )
  seed_note(
    brand,
    x: 600, y: 188, w: 250, h: 190,
    text: "Confident, but never cold.",
    color: "#B9E3C8", nickname: "Jon Bell"
  )

  seed_stroke(
    brand,
    [ [ 16, 410 ], [ 76, 400 ], [ 139, 414 ], [ 221, 404 ], [ 299, 413 ], [ 370, 403 ] ],
    color: "#FF6541", width: 4, nickname: "Ada Okafor"
  )
  seed_text(
    brand,
    x: 4, y: 468,
    text: "A little colour. A lot of personality.",
    color: "#948A7D", font_size: 20, max_width: 610,
    nickname: "Jon Bell"
  )

  # Offsite plan
  offsite = Board.create!(
    name: "Team offsite \u00B7 plans & dreams",
    theme: "cloud",
    creator_nickname: "Kai Park",
    created_at: 12.days.ago
  )

  seed_highlighter(offsite, 0, 51, 612, 51, color: "#FFD166", width: 15, nickname: "Kai Park")
  seed_text(
    offsite,
    x: 0, y: 0,
    text: "Two days. One cabin. Zero slide decks.",
    color: "#191521", font_size: 44, max_width: 900,
    nickname: "Kai Park"
  )
  seed_text(
    offsite,
    x: 3, y: 77,
    text: "The only rule: bring one idea worth arguing about.",
    color: "#6F665C", font_size: 21, max_width: 770,
    nickname: "Maya Chen"
  )

  seed_note(
    offsite,
    x: 0, y: 150, w: 250, h: 175,
    text: "Morning: walk, coffee, no laptops.",
    color: "#B9E3C8", nickname: "Kai Park"
  )
  seed_note(
    offsite,
    x: 296, y: 150, w: 250, h: 175,
    text: "Afternoon: build the weird prototype.",
    color: "#FFD97D", nickname: "Maya Chen"
  )
  seed_note(
    offsite,
    x: 592, y: 150, w: 250, h: 175,
    text: "Evening: cook together, share the wins.",
    color: "#BFD9FF", nickname: "Ada Okafor"
  )

  seed_line(offsite, 264, 228, 288, 228, color: "#FF6541", width: 3, nickname: "Kai Park", kind: "line")
  seed_line(offsite, 559, 228, 583, 228, color: "#FF6541", width: 3, nickname: "Kai Park", kind: "line")

  seed_stroke(
    offsite,
    [ [ 30, 382 ], [ 132, 374 ], [ 228, 386 ], [ 338, 375 ], [ 436, 384 ], [ 532, 376 ] ],
    color: "#0E8A79", width: 4, nickname: "Ada Okafor"
  )
  seed_text(
    offsite,
    x: 3, y: 425,
    text: "Somewhere to put the ideas that don't fit in a calendar invite.",
    color: "#948A7D", font_size: 19, max_width: 760,
    nickname: "Kai Park"
  )

  [ welcome, sprint, brand, offsite ].each_with_index do |board, index|
    activity = [ 2.minutes.ago, 1.hour.ago, 1.day.ago, 3.days.ago ][index]
    board.update_columns(updated_at: activity, last_activity_at: activity)
  end

  puts "Created #{Board.count} demo boards with #{BoardElement.count} marks."
end
