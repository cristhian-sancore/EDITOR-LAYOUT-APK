FROM nginx:alpine

# Copy the frontend files to nginx html folder
COPY . /usr/share/nginx/html/

# Create default configuration with proxy settings
RUN echo 'server { \
    listen 80; \
    client_max_body_size 50M; \
    location / { root /usr/share/nginx/html; index index.html index.htm; } \
    location /api/ { \
        proxy_pass http://backend-editor-apk:8000/api/; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
        proxy_read_timeout 600s; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Adjust the editor JS to use the correct API path
RUN sed -i 's|http://localhost:8000||g' /usr/share/nginx/html/editor.html && \
    sed -i 's|http://localhost:8000||g' /usr/share/nginx/html/index.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
