# Generated by Django 2.1.7 on 2019-03-02 23:17

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0005_auto_20190303_0012'),
    ]

    operations = [
        migrations.AlterField(
            model_name='event',
            name='date',
            field=models.DateTimeField(default=None, null=None),
        ),
    ]