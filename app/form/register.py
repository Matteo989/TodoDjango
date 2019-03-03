from django import forms
from django.contrib.auth.models import User


class RegisterForm(forms.ModelForm):
    email = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))
    password = forms.CharField(max_length=255, widget=forms.PasswordInput(attrs={'class': "form-control"}))
    username = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))

    class Meta:
        model = User
        widgets = {
            'password': forms.PasswordInput()
        }

        fields = ['email', 'username', 'password']
