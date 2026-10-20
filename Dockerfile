FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 DB_PATH=/data/habits.db
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY webapp ./webapp
CMD ["python", "app.py"]
