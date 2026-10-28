class SessionsController < ApplicationController
  def create
    nickname = UserIdentity.normalize(params[:nickname])

    if nickname.blank?
      redirect_to root_path, alert: "Choose a nickname so people know who is drawing."
      return
    end

    session[:nickname] = nickname
    redirect_to remember_destination, notice: "Welcome to Tandem, #{nickname}."
  end

  def update
    nickname = UserIdentity.normalize(params[:nickname])

    if nickname.blank?
      redirect_back fallback_location: root_path,
                  alert: "Your nickname can\u2019t be empty."
      return
    end

    session[:nickname] = nickname
    redirect_to root_path, notice: "You\u2019re now drawing as #{nickname}."
  end

  def destroy
    session.delete(:nickname)
    session.delete(:return_to)
    redirect_to root_path, notice: "You left the workspace."
  end
end
