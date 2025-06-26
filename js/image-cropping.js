document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration (Same as resizing) ---
    const BYTES_PER_PIXEL = 4;
    const MEMORY_BUDGET_RATIO = 0.25;
    const MIN_MEMORY_BUDGET = 256 * 1024 * 1024;
    const MAX_MEMORY_BUDGET = 1024 * 1024 * 1024;
    const MAX_IMAGES_PER_BATCH = 50;

    // --- State Variables ---
    let allFiles = [], batches = [], directoryHandle = null, cropper = null;

    // --- DOM Elements ---
    const $imageUpload = $('#image-upload');
    const $processBtn = $('#process-btn');
    const $status = $('#status');
    const $selectFolderBtn = $('#select-folder-btn');
    const $cropperImage = $('#cropper-image');
    
    // --- Event Listeners ---
    $imageUpload.on('change', handleFileSelection);
    $selectFolderBtn.on('click', getDirectoryHandle);
    $processBtn.on('click', startProcessing);

    // --- Core Functions ---

    // This function is identical to the one in image-resizing.js
    async function getDirectoryHandle() {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support selecting a folder. Files will be downloaded as .zip archives.");
            return;
        }
        try {
            directoryHandle = await window.showDirectoryPicker();
            $('#folder-name').text(directoryHandle.name);
            $('#download-banner').removeClass('d-none').show().delay(4000).fadeOut();
        } catch (err) { directoryHandle = null; }
    }

    async function handleFileSelection(e) {
        allFiles = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (allFiles.length === 0) {
            $processBtn.prop('disabled', true);
            $status.text('No valid image files selected.').addClass('alert-warning');
            return;
        }
        
        // Initialize Cropper.js with the first image
        if (cropper) cropper.destroy();
        const firstFileUrl = URL.createObjectURL(allFiles[0]);
        $cropperImage.attr('src', firstFileUrl).show();
        cropper = new Cropper($cropperImage[0], { viewMode: 1, autoCropArea: 0.8 });

        $status.html(`<span class="spinner-border spinner-border-sm"></span> Analyzing ${allFiles.length} images...`);
        
        await createSmartBatches();

        $processBtn.prop('disabled', false);
        let statusText = `Ready to process <strong>${allFiles.length}</strong> images in <strong>${batches.length}</strong> batches.`;
        if (directoryHandle) statusText += ` They will be saved to the '<strong>${directoryHandle.name}</strong>' folder.`;
        $status.html(statusText).addClass('alert-info').removeClass('alert-warning');
    }

    // This Smart Batching engine is identical to the one in image-resizing.js
    async function createSmartBatches() {
        const deviceMemory = navigator.deviceMemory || 2;
        const memoryBudget = Math.max(MIN_MEMORY_BUDGET, Math.min(MAX_MEMORY_BUDGET, deviceMemory * 1024 * 1024 * 1024 * MEMORY_BUDGET_RATIO));
        batches = [];
        let currentBatch = [], currentBatchCost = 0;
        for (const file of allFiles) {
            const imageCost = await getImageMemoryCost(file);
            if (currentBatch.length > 0 && (currentBatchCost + imageCost > memoryBudget || currentBatch.length >= MAX_IMAGES_PER_BATCH)) {
                batches.push(currentBatch);
                currentBatch = []; currentBatchCost = 0;
            }
            currentBatch.push(file); currentBatchCost += imageCost;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);
    }
    
    function getImageMemoryCost(file) { /* ... identical to resizing.js ... */ }

    async function startProcessing() {
        if (batches.length === 0 || !cropper) {
            alert("Please upload images and define a crop area.");
            return;
        }
        $processBtn.prop('disabled', true).addClass('disabled');
        $imageUpload.prop('disabled', true);
        const cropData = cropper.getData(true); // Get final crop data once

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchNumber = i + 1;
            $status.html(`<span class="spinner-border spinner-border-sm"></span> Processing batch ${batchNumber}/${batches.length}...`);
            
            const processedBlobs = await Promise.all(batch.map(file => processImage(file, cropData)));
            
            if (directoryHandle) {
                $status.html(`<i class="bi bi-save"></i> Saving ${processedBlobs.filter(b=>b).length} files from batch ${batchNumber}...`);
                for (const result of processedBlobs) {
                    if (result) {
                        const fileHandle = await directoryHandle.getFileHandle(result.name, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(result.blob);
                        await writable.close();
                    }
                }
            } else {
                // Fallback to ZIP download
                $status.html(`<i class="bi bi-archive"></i> Zipping batch ${batchNumber}...`);
                const zip = new JSZip();
                processedBlobs.forEach(result => { if (result) zip.file(result.name, result.blob); });
                const zipBlob = await zip.generateAsync({ type: "blob" });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(zipBlob);
                link.download = `imager_cropped_batch_${batchNumber}.zip`;
                link.click();
                URL.revokeObjectURL(link.href);
            }
        }
        
        $status.html(`<strong>Processing complete!</strong>`).addClass('alert-success').removeClass('alert-info');
        $processBtn.prop('disabled', false).removeClass('disabled');
        $imageUpload.prop('disabled', false);
    }

    function processImage(file, cropData) {
        return new Promise(resolve => {
            const settings = {
                orientation: $('#orientation-select').val(),
                format: $('#format-select').val(),
                stripMeta: $('#strip-metadata').is(':checked'),
            };

            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = async () => {
                    let canvas = document.createElement('canvas');
                    let ctx = canvas.getContext('2d');
                    
                    // 1. Handle Orientation
                    let w = img.width, h = img.height;
                    let needsRotation = (settings.orientation === 'landscape' && h > w) || (settings.orientation === 'portrait' && w > h);
                    if (needsRotation) {
                        canvas.width = h; canvas.height = w;
                        ctx.rotate(90 * Math.PI / 180); ctx.translate(0, -h);
                    } else {
                        canvas.width = w; canvas.height = h;
                    }
                    ctx.drawImage(img, 0, 0);

                    const sourceImg = needsRotation ? await createImageFromCanvas(canvas) : img;

                    // 2. Handle Cropping
                    canvas.width = cropData.width;
                    canvas.height = cropData.height;
                    ctx.drawImage(sourceImg, cropData.x, cropData.y, cropData.width, cropData.height, 0, 0, cropData.width, cropData.height);
                    
                    // 3. Encode to desired format
                    const { blob, extension } = await encodeCanvasToFormat(canvas, settings.format);
                    const newName = file.name.replace(/\.[^/.]+$/, "") + `_cropped.${extension}`;
                    resolve({ name: newName, blob: blob });
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    function createImageFromCanvas(canvas) { /* ... identical to resizing.js ... */ }
    
    // This is the new, reusable encoding function
    async function encodeCanvasToFormat(canvas, format) {
        const ctx = canvas.getContext('2d');
        let blob, extension;
        
        switch (format) {
            case 'image/jpeg':
            case 'image/png':
            case 'image/webp':
                blob = await new Promise(res => canvas.toBlob(res, format, 0.9));
                extension = format.split('/')[1];
                break;
            case 'image/bmp':
                const bmpData = BMP.encode(ctx.getImageData(0, 0, canvas.width, canvas.height));
                blob = new Blob([bmpData.data], { type: format });
                extension = 'bmp';
                break;
            case 'image/tiff':
                const tiffData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const tiffArrayBuffer = UTIF.encodeImage(tiffData, canvas.width, canvas.height);
                blob = new Blob([tiffArrayBuffer], { type: format });
                extension = 'tif';
                break;
            case 'image/gif':
                const gifData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const gifBuffer = new Uint8Array(omggif.GifWriter.frameSize(canvas.width, canvas.height) + 20);
                const writer = new omggif.GifWriter(gifBuffer, canvas.width, canvas.height);
                writer.addFrame(0, 0, canvas.width, canvas.height, new Uint8Array(gifData.buffer));
                const gifEnd = writer.end();
                blob = new Blob([gifBuffer.slice(0, gifEnd)], { type: format });
                extension = 'gif';
                break;
            default:
                blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                extension = 'png';
        }
        return { blob, extension };
    }
});

// $(document).ready(function() {
//     let imageFiles = [];
//     let cropper;

//     const $imageUpload = $('#image-upload');
//     const $processBtn = $('#process-btn');
//     const $cropperImage = $('#cropper-image');
//     const $fileList = $('#file-list');
//     const $fileCount = $('#file-count');
//     const $status = $('#status');

//     $imageUpload.on('change', function(e) {
//         imageFiles = Array.from(e.target.files);
//         $fileCount.text(imageFiles.length);
//         $fileList.empty();

//         if (cropper) {
//             cropper.destroy();
//             cropper = null;
//         }

//         if (imageFiles.length > 0) {
//             $processBtn.prop('disabled', false);
//             $status.text(`${imageFiles.length} files loaded. Define crop on the first image.`).removeClass('alert-danger').addClass('alert-info');
            
//             imageFiles.forEach(file => {
//                 $fileList.append(`<li class="list-group-item">${file.name}</li>`);
//             });

//             // Load first image into cropper
//             const reader = new FileReader();
//             reader.onload = function(event) {
//                 $cropperImage.attr('src', event.target.result).show();
//                 cropper = new Cropper($cropperImage[0], {
//                     viewMode: 1,
//                     dragMode: 'crop',
//                     autoCropArea: 0.8,
//                     background: false,
//                     responsive: true,
//                 });
//                 $('#crop-toolbar').removeClass('d-none');
//             };
//             reader.readAsDataURL(imageFiles[0]);
//         } else {
//             $processBtn.prop('disabled', true);
//             $cropperImage.hide().attr('src', '');
//             $status.text('Please upload images to begin.');
//             $('#crop-toolbar').addClass('d-none');
//         }
//     });
    
//     // Cropper Toolbar actions
//     $('#zoom-in').on('click', () => cropper && cropper.zoom(0.1));
//     $('#zoom-out').on('click', () => cropper && cropper.zoom(-0.1));
//     $('#move-mode').on('click', () => cropper && cropper.setDragMode('move'));
//     $('#crop-mode').on('click', () => cropper && cropper.setDragMode('crop'));
//     $('#reset-crop').on('click', () => cropper && cropper.reset());

//     $processBtn.on('click', async function() {
//         if (imageFiles.length === 0 || !cropper) {
//             alert('Please upload images and define a crop area.');
//             return;
//         }

//         $processBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Cropping...');
//         $status.text(`Cropping ${imageFiles.length} images...`);

//         const cropData = cropper.getData(true); // Get rounded crop data
//         const zip = new JSZip();
//         const promises = [];

//         for (const file of imageFiles) {
//             promises.push(cropImage(file, cropData)
//                 .then(result => {
//                     if (result) {
//                         zip.file(result.name, result.blob);
//                         $fileList.find(`li:contains("${file.name}")`).addClass('list-group-item-success');
//                     } else {
//                         $fileList.find(`li:contains("${file.name}")`).addClass('list-group-item-danger').append(' - Failed');
//                     }
//                 })
//             );
//         }

//         await Promise.all(promises);

//         zip.generateAsync({ type: "blob" }).then(content => {
//             const link = document.createElement('a');
//             const dateTime = new Date().toISOString().replace(/[:.]/g, '-');
//             link.href = URL.createObjectURL(content);
//             link.download = `Imager-Cropped-${dateTime}.zip`;
//             document.body.appendChild(link);
//             link.click();
//             document.body.removeChild(link);

//             $status.text('Cropping complete! Your download should start.').addClass('alert-success');
//             $processBtn.prop('disabled', false).html('<i class="bi bi-scissors"></i> Crop and Download ZIP');
//         });
//     });

//     function cropImage(file, cropData) {
//         return new Promise((resolve) => {
//             const reader = new FileReader();
//             reader.onload = function(e) {
//                 const img = new Image();
//                 img.onload = function() {
//                     const canvas = document.createElement('canvas');
//                     const ctx = canvas.getContext('2d');
                    
//                     canvas.width = cropData.width;
//                     canvas.height = cropData.height;

//                     // sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight
//                     ctx.drawImage(img, cropData.x, cropData.y, cropData.width, cropData.height, 0, 0, cropData.width, cropData.height);

//                     canvas.toBlob(function(blob) {
//                          const newName = file.name.replace(/\.[^/.]+$/, "") + `_cropped.png`;
//                         resolve({ name: newName, blob });
//                     }, 'image/png'); // Always save as PNG for quality after crop
//                 };
//                 img.onerror = () => resolve(null);
//                 img.src = e.target.result;
//             };
//             reader.onerror = () => resolve(null);
//             reader.readAsDataURL(file);
//         });
//     }
// });