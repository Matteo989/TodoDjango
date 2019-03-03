from django.contrib import admin

# Register your models here.
from app.models import Personne
from app.models import Event

admin.site.register(Personne)
admin.site.register(Event)
