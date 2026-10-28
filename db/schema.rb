# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_26_231100) do
  create_table "board_elements", force: :cascade do |t|
    t.integer "board_id", null: false
    t.string "client_id", null: false
    t.string "client_uid", null: false
    t.string "kind", null: false
    t.string "nickname", null: false
    t.string "color", null: false
    t.float "width", default: 4.0, null: false
    t.json "payload", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["board_id", "client_uid"], name: "index_board_elements_on_board_id_and_client_uid", unique: true
    t.index ["board_id", "id"], name: "index_board_elements_on_board_id_and_id"
    t.index ["board_id"], name: "index_board_elements_on_board_id"
  end

  create_table "boards", force: :cascade do |t|
    t.string "name", null: false
    t.string "theme", default: "paper", null: false
    t.string "creator_nickname", null: false
    t.integer "elements_count", default: 0, null: false
    t.datetime "last_activity_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_boards_on_created_at"
    t.index ["updated_at"], name: "index_boards_on_updated_at"
  end

  add_foreign_key "board_elements", "boards"
end
