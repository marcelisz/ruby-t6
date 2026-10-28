class ApplicationController < ActionController::Base
  helper_method :current_nickname, :current_user_color, :current_user_initials

  private

  def current_nickname
    return @current_nickname if defined?(@current_nickname)

    @current_nickname = UserIdentity.normalize(session[:nickname]).presence
  end

  def current_user_color
    UserIdentity.color_for(current_nickname) if current_nickname
  end

  def current_user_initials
    UserIdentity.initials_for(current_nickname) if current_nickname
  end

  def require_nickname
    return if current_nickname.present?

    session[:return_to] = request.fullpath if request.get?
    redirect_to root_path
  end

  def remember_destination
    candidate = session[:return_to].to_s
    session.delete(:return_to)
    candidate.start_with?("/") && !candidate.start_with?("//") ? candidate : root_path
  end
end
