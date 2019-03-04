from django import forms
from django.contrib.auth.models import User


class EditProfilForm(forms.ModelForm):
    email = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))
    username = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))

    class Meta:
        model = User
        fields = ['email', 'username']
