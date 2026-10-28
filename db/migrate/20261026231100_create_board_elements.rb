class CreateBoardElements < ActiveRecord::Migration[8.1]
  def change
    create_table :board_elements do |t|
      t.references :board, null: false, foreign_key: true
      t.string :client_id, null: false
      t.string :client_uid, null: false
      t.string :kind, null: false
      t.string :nickname, null: false
      t.string :color, null: false
      t.float :width, null: false, default: 4.0
      t.json :payload, null: false, default: {}

      t.timestamps
    end

    add_index :board_elements, [ :board_id, :client_uid ], unique: true
    add_index :board_elements, [ :board_id, :id ]
  end
end
