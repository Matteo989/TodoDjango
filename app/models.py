# from django.db import models

# Create your models here.
from django.contrib.auth.models import User
from django.db import models
from django.http import request


class Personne(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, default=None)

    def __str__(self):
        return '{} {} {}'.format(
            self.user.first_name if self.user is not None else u'?',
            self.user.last_name if self.user is not None else u'?',
            self.user.email if self.user is not None else u'?',
        )


class Event(models.Model):
    titre = models.CharField(max_length=250, null=None, default=None)
    description = models.CharField(max_length=250, null=None, default=None)
    date = models.DateField(null=None, default=None)
    lieu = models.CharField(max_length=250, null=None, default=None)
    rappel = models.DateField(null=None, default=None)
    user = models.ForeignKey(User, on_delete=models.CASCADE, default=None)

    def __str__(self):
        return '{}'.format(
            self.titre if self is not None else u'?')
