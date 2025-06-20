$(document).ready(function() {
    let imageFiles = [];
    let cropper;

    const $imageUpload = $('#image-upload');
    const $processBtn = $('#process-btn');
    const $cropperImage = $('#cropper-image');
    const $fileList = $('#file-list');
    const $fileCount = $('#file-count');
    const $status = $('#status');

    $imageUpload.on('change', function(e) {
        imageFiles = Array.from(e.target.files);
        $fileCount.text(imageFiles.length);
        $fileList.empty();

        if (cropper) {
            cropper.destroy();
            cropper = null;
        }

        if (imageFiles.length > 0) {
            $processBtn.prop('disabled', false);
            $status.text(`${imageFiles.length} files loaded. Define crop on the first image.`).removeClass('alert-danger').addClass('alert-info');
            
            imageFiles.forEach(file => {
                $fileList.append(`<li class="list-group-item">${file.name}</li>`);
            });

            // Load first image into cropper
            const reader = new FileReader();
            reader.onload = function(event) {
                $cropperImage.attr('src', event.target.result).show();
                cropper = new Cropper($cropperImage[0], {
                    viewMode: 1,
                    dragMode: 'crop',
                    autoCropArea: 0.8,
                    background: false,
                    responsive: true,
                });
                $('#crop-toolbar').removeClass('d-none');
            };
            reader.readAsDataURL(imageFiles[0]);
        } else {
            $processBtn.prop('disabled', true);
            $cropperImage.hide().attr('src', '');
            $status.text('Please upload images to begin.');
            $('#crop-toolbar').addClass('d-none');
        }
    });
    
    // Cropper Toolbar actions
    $('#zoom-in').on('click', () => cropper && cropper.zoom(0.1));
    $('#zoom-out').on('click', () => cropper && cropper.zoom(-0.1));
    $('#move-mode').on('click', () => cropper && cropper.setDragMode('move'));
    $('#crop-mode').on('click', () => cropper && cropper.setDragMode('crop'));
    $('#reset-crop').on('click', () => cropper && cropper.reset());

    $processBtn.on('click', async function() {
        if (imageFiles.length === 0 || !cropper) {
            alert('Please upload images and define a crop area.');
            return;
        }

        $processBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Cropping...');
        $status.text(`Cropping ${imageFiles.length} images...`);

        const cropData = cropper.getData(true); // Get rounded crop data
        const zip = new JSZip();
        const promises = [];

        for (const file of imageFiles) {
            promises.push(cropImage(file, cropData)
                .then(result => {
                    if (result) {
                        zip.file(result.name, result.blob);
                        $fileList.find(`li:contains("${file.name}")`).addClass('list-group-item-success');
                    } else {
                        $fileList.find(`li:contains("${file.name}")`).addClass('list-group-item-danger').append(' - Failed');
                    }
                })
            );
        }

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(content => {
            const link = document.createElement('a');
            const dateTime = new Date().toISOString().replace(/[:.]/g, '-');
            link.href = URL.createObjectURL(content);
            link.download = `Imager-Cropped-${dateTime}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            $status.text('Cropping complete! Your download should start.').addClass('alert-success');
            $processBtn.prop('disabled', false).html('<i class="bi bi-scissors"></i> Crop and Download ZIP');
        });
    });

    function cropImage(file, cropData) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    canvas.width = cropData.width;
                    canvas.height = cropData.height;

                    // sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight
                    ctx.drawImage(img, cropData.x, cropData.y, cropData.width, cropData.height, 0, 0, cropData.width, cropData.height);

                    canvas.toBlob(function(blob) {
                         const newName = file.name.replace(/\.[^/.]+$/, "") + `_cropped.png`;
                        resolve({ name: newName, blob });
                    }, 'image/png'); // Always save as PNG for quality after crop
                };
                img.onerror = () => resolve(null);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }
});