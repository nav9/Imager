#!/bin/bash

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

# glfx.js (for WebGL image filters) - Let's ensure we get the raw file
if [ -f "$JS_DIR/glfx.js" ]; then
    rm "$JS_DIR/glfx.js" # Remove potentially corrupted file
fi
echo "Downloading glfx.js..."
curl -L "https://raw.githubusercontent.com/evanw/glfx.js/master/glfx.js" -o "$JS_DIR/glfx.js"


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

# Cropper.js CSS
if [ ! -f "$CSS_DIR/cropper.min.css" ]; then
  echo "Downloading Cropper.js CSS..."
  curl -L https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css -o "$CSS_DIR/cropper.min.css"
else
  echo "Cropper.js CSS already exists."
fi


# --- CUSTOM CSS ---
# Create a custom style file for minor adjustments
if [ ! -f "$CSS_DIR/style.css" ]; then
  echo "Creating custom stylesheet..."
  touch "$CSS_DIR/style.css"
  # Add some custom styles
  cat <<EOT >> "$CSS_DIR/style.css"
/* Custom Styles for Imager */

/* Ensure minimal margins and padding */
body {
    padding-top: 56px; /* Adjust for fixed navbar */
}

/* Make image grid responsive with minimal gap */
.image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 3px;
}

.thumbnail-container {
    position: relative;
    cursor: pointer;
}

.thumbnail {
    width: 100%;
    height: auto;
    display: block;
    border: 2px solid transparent;
    transition: border-color 0.2s linear;
    border-radius: 4px;
}

.thumbnail.selected {
    border-color: var(--bs-primary);
}

.modal-dialog-centered {
    max-width: 95vw;
}

.cropper-container {
    max-width: 100%;
}
EOT
else
    echo "Custom stylesheet already exists."
fi

echo "----------------------------------------"
echo "Installation complete."
echo "----------------------------------------"