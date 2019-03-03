# Create your views here.

from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.auth.models import User
from django.contrib.auth.views import LoginView, LogoutView
from django.db import router
from django.db.models.deletion import Collector
from django.http import HttpResponse
from django.shortcuts import render, redirect
from django.urls import reverse, reverse_lazy
from django.utils.datetime_safe import datetime
from django.views.generic import TemplateView, ListView, DetailView, FormView, CreateView, UpdateView

from app.form.register import RegisterForm
from app.form.addEvent import AddEventForm
from app.models import Event
from celery.schedules import crontab

import datetime


class IndexView(TemplateView):
    template_name = 'index.html'


class CalendarView(ListView):
    model = Event
    template_name = 'calendar.html'

    def get_queryset(self):
        # Renvoie tout les event de l'utilisateur
        return Event.objects.filter(user=self.request.user)

    def delete(request, pk):
        Event.objects.get(id=pk).delete()
        return redirect('calendar')

    def edit(request, pk):
        Event.objects.get(id=pk).delete()
        return redirect('edit_event')


class ErrorView(TemplateView):
    template_name = '404.html'


class RegisterView(FormView):
    form_class = RegisterForm
    template_name = 'register.html'

    def get_success_url(self):
        return reverse('index_view')

    def form_valid(self, form):
        user = form.save(False)
        user.set_password(user.password)
        user.save()

        return super(RegisterView, self).form_valid(form)


class MyLoginView(LoginView):
    def get_success_url(self):
        return reverse('index_view')


class MyLogoutView(LogoutView):
    next_page = 'index_view'


# Formulaire ajout event
class AddEventFormView(CreateView):
    form_class = AddEventForm
    template_name = 'addEventForm.html'

    def get_initial(self):
        initial = super(AddEventFormView, self).get_initial()
        initial['user'] = self.request.user
        return initial

    def get_success_url(self):
        return reverse('calendar')


class EditEventFormView(UpdateView):
    model = Event
    form_class = AddEventForm
    template_name = 'editEventForm.html'

    def get_success_url(self):
        return reverse('calendar')


class EditUserFormView(UpdateView):
    model = User
    fields = ['email', 'username']
    template_name = 'editUserForm.html'

    def get_context_data(self, **kwargs):
        context = super(EditUserFormView, self).get_context_data(**kwargs)
        context['username'] = User.objects.filter(username=self.request.user.username)
        return context

    def get_success_url(self):
        return reverse('calendar')
