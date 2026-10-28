class CreateBoards < ActiveRecord::Migration[8.1]
  def change
    create_table :boards do |t|
      t.string :name, null: false
      t.string :theme, null: false, default: "paper"
      t.string :creator_nickname, null: false
      t.integer :elements_count, null: false, default: 0
      t.datetime :last_activity_at, null: false

      t.timestamps
    end

    add_index :boards, :created_at
    add_index :boards, :updated_at
  end
end
