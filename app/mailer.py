import datetime

from celery import Celery
from celery.schedules import crontab

from app.models import Event

app = Celery('birthdays', broker="pyamqp://guest@localhost//")

# disable UTC so that Celery can use local time
app.conf.enable_utc = False


@app.task
def rappel_today(self):
    model: Event
    today = datetime.datetime.now()
    events = Event.objects.filter(date=today)

    if events:
        for event in events:
            event.user.email
            print(
                """
                Hi,
    
                Vous avez demandé un rappel pour cet évènement.
    
                From all of us at company TodoList.
                """
            )


# add "rappel_today" task to the beat schedule
app.conf.beat_schedule = {
    "event-task": {
        "task": "Event.rappel_today",
        "schedule": crontab(hour=7, minute=0)
    }
}
