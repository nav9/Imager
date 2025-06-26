#!/bin/bash

echo "-----------------------------------------------------"
echo "-----------------------------------------------------"
echo "-----------------------------------------------------"
echo "NOTE: This script needs to be run from the dev folder"
echo "-----------------------------------------------------"
echo "-----------------------------------------------------"
echo "-----------------------------------------------------"

# Define the target directory for JavaScript and CSS files
JS_DIR="../js"
CSS_DIR="../css"
FONTS_DIR="../fonts" # <-- Add fonts directory

# Create directories if they don't exist
mkdir -p "$JS_DIR"
mkdir -p "$CSS_DIR"
mkdir -p "$FONTS_DIR" # <-- Create fonts directory

echo "Starting download of dependencies..."

# --- JAVASCRIPT LIBRARIES ---

# jQuery
if [ ! -f "$JS_DIR/jquery.min.js" ]; then
  echo "Downloading jQuery..."
  curl -L https://code.jquery.com/jquery-3.7.1.min.js -o "$JS_DIR/jquery.min.js"
else
  echo "jQuery already exists."
fi

# Bootstrap JS Bundle (includes Popper.js)
if [ ! -f "$JS_DIR/bootstrap.bundle.min.js" ]; then
  echo "Downloading Bootstrap JS..."
  curl -L https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js -o "$JS_DIR/bootstrap.bundle.min.js"
else
  echo "Bootstrap JS already exists."
fi

# # glfx.js (for WebGL image filters) - Let's ensure we get the raw file
# if [ -f "$JS_DIR/glfx.js" ]; then
#     rm "$JS_DIR/glfx.js" # Remove potentially corrupted file
# fi
# echo "Downloading glfx.js..."
# curl -L "https://evanw.github.io/glfx.js/glfx.js" -o "$JS_DIR/glfx.js"
# #curl -L "https://raw.githubusercontent.com/evanw/glfx.js/master/glfx.js" -o "$JS_DIR/glfx.js"


# JSZip (for zipping and downloading files)
if [ ! -f "$JS_DIR/jszip.min.js" ]; then
  echo "Downloading JSZip..."
  curl -L https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js -o "$JS_DIR/jszip.min.js"
else
  echo "JSZip already exists."
fi

# Cropper.js (for image cropping)
if [ ! -f "$JS_DIR/cropper.min.js" ]; then
  echo "Downloading Cropper.js..."
  curl -L https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js -o "$JS_DIR/cropper.min.js"
else
  echo "Cropper.js already exists."
fi

# Cropper CSS
if [ ! -f "$CSS_DIR/cropper.min.css" ]; then
  echo "Downloading Cropper.js CSS..."
  curl -L https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css -o "$CSS_DIR/cropper.min.css"
else
  echo "Cropper.js CSS already exists."
fi

# OpenCV.js (for advanced image processing)
# This is a large file, download may be slow.
if [ ! -f "$JS_DIR/opencv.js" ]; then
  echo "Downloading OpenCV.js (this may take a minute)..."
  curl -L https://docs.opencv.org/4.9.0/opencv.js -o "$JS_DIR/opencv.js"
else
  echo "OpenCV.js already exists."
fi

# UTIF.js for TIFF encoding
if [ ! -f "$JS_DIR/UTIF.js" ]; then
  echo "Downloading UTIF.js for TIFF support..."
  curl -L https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js -o "$JS_DIR/UTIF.js"
else
  echo "UTIF.js already exists."
fi

# A library for BMP encoding
if [ ! -f "$JS_DIR/bmp.js" ]; then
  echo "Downloading bmp.js for BMP support..."
  curl -L "https://cdn.jsdelivr.net/gh/alicelab/bmp-js@main/bmp.js" -o "$JS_DIR/bmp.js"
else
  echo "bmp.js already exists."
fi

# A library for GIF encoding (omggif)
if [ ! -f "$JS_DIR/omggif.js" ]; then
  echo "Downloading omggif.js for GIF support..."
  curl -L "https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js" -o "$JS_DIR/omggif.js"
else
  echo "omggif.js already exists."
fi

# --- CSS FILES ---

# Bootstrap Dark Theme CSS
if [ ! -f "$CSS_DIR/bootstrap.min.css" ]; then
  echo "Downloading Bootstrap Dark CSS..."
  # We will use a pre-compiled dark theme (Bootswatch "darkly")
  curl -L https://cdn.jsdelivr.net/npm/bootswatch@5.3.3/dist/darkly/bootstrap.min.css -o "$CSS_DIR/bootstrap.min.css"
else
  echo "Bootstrap CSS already exists."
fi

# --- BOOTSTRAP ICONS (CSS + FONTS) ---
# This is the key change to fix the font error

# Download Bootstrap Icons CSS
if [ ! -f "$CSS_DIR/bootstrap-icons.min.css" ]; then
  echo "Downloading Bootstrap Icons CSS..."
  curl -L "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" -o "$CSS_DIR/bootstrap-icons.min.css"
else
  echo "Bootstrap Icons CSS already exists."
fi

# Download Bootstrap Icons Font File (WOFF2)
if [ ! -f "$FONTS_DIR/bootstrap-icons.woff2" ]; then
  echo "Downloading Bootstrap Icons WOFF2 Font..."
  curl -L "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2" -o "$FONTS_DIR/bootstrap-icons.woff2"
else
  echo "Bootstrap Icons WOFF2 Font already exists."
fi

# Download Bootstrap Icons Font File (WOFF) - for broader compatibility
if [ ! -f "$FONTS_DIR/bootstrap-icons.woff" ]; then
  echo "Downloading Bootstrap Icons WOFF Font..."
  curl -L "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff" -o "$FONTS_DIR/bootstrap-icons.woff"
else
  echo "Bootstrap Icons WOFF Font already exists."
fi



echo "----------------------------------------"
echo "Installation complete."
echo "----------------------------------------"
