# Generated by Django 2.1.7 on 2019-03-02 23:21

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0008_auto_20190303_0020'),
    ]

    operations = [
        migrations.AlterField(
            model_name='event',
            name='date',
            field=models.DateField(default=None, null=None),
        ),
    ]
