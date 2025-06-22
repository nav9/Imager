$(document).ready(function() {
    let imageFiles = [];

    const $imageUpload = $('#image-upload');
    const $processBtn = $('#process-btn');
    const $fileList = $('#file-list');
    const $fileCount = $('#file-count');
    const $status = $('#status');

    const BATCH_SIZE = 10; // Process 10 images at a time

    // Toggle input sections based on radio selection
    $('input[name="resize-method"]').on('change', function() {
        if (this.value === 'dims') {
            $('#dims-inputs').removeClass('d-none');
            $('#ratio-input').addClass('d-none');
        } else {
            $('#dims-inputs').addClass('d-none');
            $('#ratio-input').removeClass('d-none');
        }
    });

    $imageUpload.on('change', function(e) {
        imageFiles = Array.from(e.target.files);
        $fileList.empty();
        $fileCount.text(imageFiles.length);

        if (imageFiles.length > 0) {
            $processBtn.prop('disabled', false);
            $status.text(`${imageFiles.length} files loaded and ready for processing.`).removeClass('alert-danger').addClass('alert-info');
            imageFiles.forEach(file => {
                $fileList.append(`<li class="list-group-item">${file.name} (${(file.size / 1024).toFixed(1)} KB)</li>`);
            });
        } else {
            $processBtn.prop('disabled', true);
            $status.text('Please upload images to begin.').removeClass('alert-info');
        }
    });

    $processBtn.on('click', async function() {
        if (imageFiles.length === 0) {
            alert('No files selected.');
            return;
        }

        // const filesToProcess = [...imageFiles]; // Create a copy
        // const totalBatches = Math.ceil(filesToProcess.length / BATCH_SIZE);
        // let currentBatch = 1;        

        const method = $('input[name="resize-method"]:checked').val();
        const targetWidth = parseInt($('#resize-width').val());
        const targetHeight = parseInt($('#resize-height').val());
        const ratio = parseInt($('#resize-ratio').val());

        if (method === 'dims' && (!targetWidth || !targetHeight)) {
            alert('Please specify both width and height.');
            return;
        }
        if (method === 'ratio' && !ratio) {
            alert('Please specify a ratio.');
            return;
        }
        
        $processBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...');
        $status.text(`Processing ${imageFiles.length} images... This may take a moment.`);
        
        const zip = new JSZip();
        const promises = [];

        for (const file of imageFiles) {
            promises.push(processImage(file, method, targetWidth, targetHeight, ratio)
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
            link.download = `Imager-Resized-${dateTime}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            $status.text(`Processing complete! Your download should begin shortly.`).removeClass('alert-info').addClass('alert-success');
            $processBtn.prop('disabled', false).html('<i class="bi bi-gear-wide-connected"></i> Process and Download ZIP');
        });
    });

    function processImage(file, method, w, h, ratio) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    let newWidth, newHeight;
                    if (method === 'ratio') {
                        newWidth = img.width * (ratio / 100);
                        newHeight = img.height * (ratio / 100);
                    } else {
                        newWidth = w;
                        newHeight = h;
                    }
                    
                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    ctx.drawImage(img, 0, 0, newWidth, newHeight);

                    canvas.toBlob(function(blob) {
                        const fileExt = file.name.split('.').pop().toLowerCase();
                        const newName = file.name.replace(/\.[^/.]+$/, "") + `_resized.${fileExt === 'gif' ? 'png' : fileExt}`;
                        resolve({ name: newName, blob });
                    }, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
                };
                img.onerror = () => resolve(null);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }
});