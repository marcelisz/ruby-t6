Rails.application.routes.draw do
  root "boards#index"

  post   "enter",   to: "sessions#create",  as: :enter
  patch  "profile", to: "sessions#update",  as: :profile
  delete "leave",   to: "sessions#destroy", as: :leave

  resources :boards, only: [ :index, :create, :show, :destroy ] do
    member do
      get :thumbnail
    end
  end

  mount ActionCable.server => "/cable"

  # Reveal health status on /up that returns 200 if the app boots with no exceptions.
  get "up" => "rails/health#show", as: :rails_health_check
end
