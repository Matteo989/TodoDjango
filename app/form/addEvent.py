from django import forms

from app.models import Event


class AddEventForm(forms.ModelForm):
    titre = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))
    description = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))
    lieu = forms.CharField(max_length=255, widget=forms.TextInput(attrs={'class': "form-control"}))
    date = forms.DateTimeField(widget=forms.DateInput(attrs={'type': "date", 'class': "form-control"}))
    rappel = forms.DateTimeField(widget=forms.DateInput(attrs={'type': "date", 'class': "form-control"}))

    class Meta:
        model = Event
        fields = ['titre', 'description', 'date', 'lieu', 'rappel', 'user']
