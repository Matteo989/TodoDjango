# Generated by Django 2.1.7 on 2019-03-03 02:31

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0010_auto_20190303_0039'),
    ]

    operations = [
        migrations.AlterField(
            model_name='event',
            name='rappel',
            field=models.DateField(default=None, null=None),
        ),
        migrations.AlterField(
            model_name='event',
            name='user',
            field=models.ForeignKey(default=None, on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL),
        ),
    ]