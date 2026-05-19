FROM python:3.10-slim

# Install system dependencies: Java, apktool, zipalign, apksigner
RUN apt-get update && apt-get install -y \
    default-jdk-headless \
    wget \
    zipalign \
    apksigner \
    && rm -rf /var/lib/apt/lists/*

# Install apktool manually to get a recent version
RUN wget https://raw.githubusercontent.com/iBotPeaches/Apktool/master/scripts/linux/apktool -O /usr/local/bin/apktool && \
    chmod +x /usr/local/bin/apktool && \
    wget https://bitbucket.org/iBotPeaches/apktool/downloads/apktool_2.9.3.jar -O /usr/local/bin/apktool.jar && \
    chmod +x /usr/local/bin/apktool.jar

WORKDIR /app

# Generate a default debug keystore so we can sign APKs automatically
RUN keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create workspace dir for APK processing
RUN mkdir -p /app/workspace

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
