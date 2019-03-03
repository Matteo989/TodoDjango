from django.contrib import admin
from django.urls import path, include

from app.views import IndexView, ErrorView, RegisterView, MyLoginView, MyLogoutView, CalendarView, AddEventFormView, \
    EditEventFormView, EditUserFormView

urlpatterns = [
    path('i18n/', include('django.conf.urls.i18n')),
    path('admin/', admin.site.urls),
    path('', IndexView.as_view(),
         name='index'),
    path('', IndexView.as_view(),
         name='index_view'),
    path('404', ErrorView.as_view()),
    path('register/', RegisterView.as_view(),
         name='register'),
    path('login/', MyLoginView.as_view(),
         name='login'),
    path('logout/', MyLogoutView.as_view(),
         name='logout'),
    path('calendar/', CalendarView.as_view(),
         name='calendar'),
    path('calendar/add', AddEventFormView.as_view(),
         name='add_event'),
    path('calendar/delete/<int:pk>', CalendarView.delete,
         name='delete_event'),
    path('calendar/edit/<int:pk>', EditEventFormView.as_view(),
         name='edit_event'),
    path('edit_user/<int:pk>', EditUserFormView.as_view(),
         name='edit_user'),
]
