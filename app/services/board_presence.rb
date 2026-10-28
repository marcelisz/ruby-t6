module BoardPresence
  @mutex = Mutex.new
  @rooms = {}

  class << self
    def join(board_id, session_id, nickname:, color:)
      @mutex.synchronize do
        room = rooms[board_id] ||= {}
        room[session_id] = {
          id: session_id,
          nickname: nickname,
          color: color,
          initials: UserIdentity.initials_for(nickname),
          joined_at: Time.current.to_i
        }
      end
    end

    def leave(board_id, session_id)
      @mutex.synchronize do
        room = rooms[board_id]
        next if room.nil?

        room.delete(session_id)
        rooms.delete(board_id) if room.empty?
      end
    end

    def participants(board_id)
      @mutex.synchronize do
        rooms.fetch(board_id, {}).values
             .sort_by { |participant| participant[:joined_at] }
             .map(&:dup)
      end
    end

    def count(board_id)
      @mutex.synchronize { rooms.fetch(board_id, {}).size }
    end

    private

    def rooms
      @rooms
    end
  end
end
