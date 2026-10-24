# Ajouté par le panel admin (projet Python détecté). Adapte la commande si besoin.
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
COPY . .
ENV PYTHONUNBUFFERED=1
USER nobody
CMD ["python", "__PYTHON_MAIN__"]
