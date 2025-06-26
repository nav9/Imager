document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // Heuristic: Estimate memory cost per pixel (RGBA = 4 bytes)
    const BYTES_PER_PIXEL = 4;
    // Heuristic: Use max 25% of device RAM for a single batch, with a floor and ceiling.
    const MEMORY_BUDGET_RATIO = 0.25;
    const MIN_MEMORY_BUDGET = 256 * 1024 * 1024; // 256 MB
    const MAX_MEMORY_BUDGET = 1024 * 1024 * 1024; // 1 GB
    const MAX_IMAGES_PER_BATCH = 50; // A hard limit to prevent too many files at once

    // --- State Variables ---
    let allFiles = [];
    let batches = [];
    let directoryHandle = null;

    // --- DOM Elements ---
    const $imageUpload = $('#image-upload');
    const $processBtn = $('#process-btn');
    const $status = $('#status');
    const $selectFolderBtn = $('#select-folder-btn');
    
    // --- Event Listeners ---
    $imageUpload.on('change', handleFileSelection);
    $selectFolderBtn.on('click', getDirectoryHandle);
    $processBtn.on('click', startProcessing);
    $('input[name="resize-method"]').on('change', toggleResizeInputs);

    function toggleResizeInputs() {
        if (this.value === 'dims') {
            $('#dims-inputs').removeClass('d-none');
            $('#ratio-input').addClass('d-none');
        } else {
            $('#dims-inputs').addClass('d-none');
            $('#ratio-input').removeClass('d-none');
        }
    }

    async function getDirectoryHandle() {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support selecting a folder. Files will be downloaded as .zip archives.");
            return;
        }
        try {
            directoryHandle = await window.showDirectoryPicker();
            const folderName = directoryHandle.name;
            $('#folder-name').text(folderName);
            $('#download-banner').removeClass('d-none').show().delay(4000).fadeOut();
        } catch (err) {
            console.error("Error picking directory:", err);
            directoryHandle = null;
        }
    }

    async function handleFileSelection(e) {
        allFiles = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (allFiles.length === 0) {
            $processBtn.prop('disabled', true);
            $status.text('No valid image files selected.').addClass('alert-warning').removeClass('alert-info alert-success');
            return;
        }
        
        $status.html(`<span class="spinner-border spinner-border-sm"></span> Analyzing ${allFiles.length} images to create smart batches...`);
        
        // --- Smart Batching Logic ---
        await createSmartBatches();

        $processBtn.prop('disabled', false);
        let statusText = `Ready to process <strong>${allFiles.length}</strong> images in <strong>${batches.length}</strong> batches.`;
        if (directoryHandle) statusText += ` They will be saved to the '<strong>${directoryHandle.name}</strong>' folder.`;
        $status.html(statusText).addClass('alert-info').removeClass('alert-warning alert-success');
    }

    async function createSmartBatches() {
        // Estimate device capability
        const deviceMemory = navigator.deviceMemory || 2; // Default to 2GB if unavailable
        const memoryBudget = Math.max(MIN_MEMORY_BUDGET, Math.min(MAX_MEMORY_BUDGET, deviceMemory * 1024 * 1024 * 1024 * MEMORY_BUDGET_RATIO));
        
        batches = [];
        let currentBatch = [];
        let currentBatchCost = 0;

        for (const file of allFiles) {
            const imageCost = await getImageMemoryCost(file);

            if (currentBatch.length > 0 && (currentBatchCost + imageCost > memoryBudget || currentBatch.length >= MAX_IMAGES_PER_BATCH)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBatchCost = 0;
            }
            currentBatch.push(file);
            currentBatchCost += imageCost;
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }
    }
    
    function getImageMemoryCost(file) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                resolve(img.width * img.height * BYTES_PER_PIXEL);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve(file.size * 4); // Fallback: estimate decoded size is 4x file size
            img.src = URL.createObjectURL(file);
        });
    }

    async function startProcessing() {
        if (batches.length === 0) return;

        $processBtn.prop('disabled', true);
        $imageUpload.prop('disabled', true);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchNumber = i + 1;
            $status.html(`<span class="spinner-border spinner-border-sm"></span> Processing batch ${batchNumber} of ${batches.length} (${batch.length} images)...`);
            
            const processedBlobs = await Promise.all(batch.map(processImage));
            
            if (directoryHandle) {
                $status.html(`<i class="bi bi-save"></i> Saving ${processedBlobs.filter(b => b).length} files from batch ${batchNumber} to '<strong>${directoryHandle.name}</strong>'...`);
                for (const result of processedBlobs) {
                    if (result) {
                        const fileHandle = await directoryHandle.getFileHandle(result.name, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(result.blob);
                        await writable.close();
                    }
                }
            } else {
                $status.html(`<i class="bi bi-archive"></i> Zipping batch ${batchNumber}...`);
                const zip = new JSZip();
                processedBlobs.forEach(result => {
                    if (result) zip.file(result.name, result.blob);
                });
                const zipBlob = await zip.generateAsync({ type: "blob" });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(zipBlob);
                link.download = `imager_batch_${batchNumber}_of_${batches.length}.zip`;
                link.click();
                URL.revokeObjectURL(link.href);
            }
        }
        
        $status.html(`<strong>Processing complete!</strong> ${allFiles.length} images processed in ${batches.length} batches.`).addClass('alert-success').removeClass('alert-info');
        $processBtn.prop('disabled', false);
        $imageUpload.prop('disabled', false);
    }


// // This is the replacement for the processImage function in js/image-resizing.js

// function processImage(file) {
//     return new Promise(resolve => {
//         const settings = {
//             method: $('input[name="resize-method"]:checked').val(),
//             w: parseInt($('#resize-width').val()),
//             h: parseInt($('#resize-height').val()),
//             ratio: parseInt($('#resize-ratio').val()),
//             orientation: $('#orientation-select').val(),
//             format: $('#format-select').val(),
//             stripMeta: $('#strip-metadata').is(':checked'),
//         };

//         const reader = new FileReader();
//         reader.onload = e => {
//             const img = new Image();
//             img.onload = async () => {
//                 let canvas = document.createElement('canvas');
//                 let ctx = canvas.getContext('2d');
                
//                 // 1. Handle Orientation
//                 let w = img.width, h = img.height;
//                 let needsRotation = (settings.orientation === 'landscape' && h > w) || (settings.orientation === 'portrait' && w > h);
//                 if (needsRotation) {
//                     canvas.width = h; canvas.height = w;
//                     ctx.rotate(90 * Math.PI / 180); ctx.translate(0, -h);
//                 } else {
//                     canvas.width = w; canvas.height = h;
//                 }
//                 ctx.drawImage(img, 0, 0);

//                 const sourceImg = needsRotation ? await createImageFromCanvas(canvas) : img;

//                 // 2. Handle Resizing
//                 let newWidth, newHeight;
//                 if (settings.method === 'ratio') {
//                     newWidth = sourceImg.width * (settings.ratio / 100);
//                     newHeight = sourceImg.height * (settings.ratio / 100);
//                 } else {
//                     newWidth = settings.w; newHeight = settings.h;
//                 }
//                 canvas.width = newWidth; canvas.height = newHeight;
//                 ctx.drawImage(sourceImg, 0, 0, newWidth, newHeight);

//                 // 3. Encode to desired format
//                 const { blob, extension } = await encodeCanvasToFormat(canvas, settings.format);
//                 const newName = file.name.replace(/\.[^/.]+$/, "") + `_resized.${extension}`;
//                 resolve({ name: newName, blob: blob });
//             };
//             img.src = e.target.result;
//         };
//         reader.readAsDataURL(file);
//     });
// }

// // Also, add the new encodeCanvasToFormat and createImageFromCanvas functions to image-resizing.js
// // You can copy them directly from the image-cropping.js file above.

    function processImage(file) {
        return new Promise(resolve => {
            // Get processing settings from UI
            const settings = {
                method: $('input[name="resize-method"]:checked').val(),
                w: parseInt($('#resize-width').val()),
                h: parseInt($('#resize-height').val()),
                ratio: parseInt($('#resize-ratio').val()),
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
                    let w = img.width;
                    let h = img.height;
                    let needsRotation = (settings.orientation === 'landscape' && h > w) || (settings.orientation === 'portrait' && w > h);
                    
                    if (needsRotation) {
                        canvas.width = h; canvas.height = w;
                        ctx.rotate(90 * Math.PI / 180);
                        ctx.translate(0, -h);
                    } else {
                        canvas.width = w; canvas.height = h;
                    }
                    ctx.drawImage(img, 0, 0);

                    // If we rotated, create a new source image from the rotated canvas
                    const sourceImg = needsRotation ? await createImageFromCanvas(canvas) : img;

                    // 2. Handle Resizing
                    let newWidth, newHeight;
                    if (settings.method === 'ratio') {
                        newWidth = sourceImg.width * (settings.ratio / 100);
                        newHeight = sourceImg.height * (settings.ratio / 100);
                    } else {
                        newWidth = settings.w;
                        newHeight = settings.h;
                    }

                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    ctx.drawImage(sourceImg, 0, 0, newWidth, newHeight);

                    // 3. Get Blob in desired format
                    canvas.toBlob(blob => {
                        const fileExt = settings.format.split('/')[1];
                        const newName = file.name.replace(/\.[^/.]+$/, "") + `_resized.${fileExt}`;
                        resolve({ name: newName, blob: blob });
                    }, settings.format, 0.9); // 0.9 quality for JPG/WEBP
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    function createImageFromCanvas(canvas) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = canvas.toDataURL();
        });
    }
});