// A $(document).ready() block is not needed because the script is deferred.
// The DOM will be fully ready when this script executes.

// --- Configuration ---
const ALL_FILTERS = {
    brightness: { min: -100, max: 100, name: "Brightness" },
    contrast: { min: 1.0, max: 3.0, name: "Contrast" },
    saturation: { min: 0.0, max: 3.0, name: "Saturation" },
    clahe: { min: 1.0, max: 10.0, name: "CLAHE" },
    blur: { min: 1, max: 15, name: "Blur" },
    median: { min: 3, max: 15, name: "Median" },
    sharpen: { min: 0, max: 1, name: "Sharpen" },
    denoise: { min: 1, max: 21, name: "Denoise" },
    canny: { min: 20, max: 100, name: "Canny Edges" },
    sobel: { min: 1, max: 5, name: "Sobel Edges" },
    erode: { min: 1, max: 9, name: "Erode" },
    dilate: { min: 1, max: 9, name: "Dilate" },
    threshold: { min: 50, max: 200, name: "Threshold" },
    invert: { min: 0, max: 1, name: "Invert" },
};
const MAX_FILTER_CHAIN_LENGTH = 8; // Max number of filters in a sequence

// --- State Variables ---
let originalImage = null, srcMat = null, population = [], history = [];
let globalBest = null, isProcessing = false, pageIsDirty = false;
let timerInterval, generationTimes = [];

// --- DOM Elements ---
const $statusText = $('#status-text'), $imageGrid = $('#image-grid'), $overlay = $('#processing-overlay');
const $filterCheckboxesContainer = $('#filter-checkboxes');
const $historyDropdown = $('#history-dropdown');
const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

// --- Particle Class for Dynamic Filter Chains ---
class Particle {
    constructor(availableFilters) {
        this.position = []; this.velocity = [];
        this.pbest = { position: [], fitness: Infinity };
        this.fitness = Infinity;
        for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
            this.position.push(Math.random(), Math.random(), Math.random()); // [filter_type, filter_value, is_active]
            this.velocity.push(0, 0, 0);
        }
    }
    update(gbestPosition, psoParams) {
        const { w, c1, c2 } = psoParams;
        for (let i = 0; i < this.position.length; i++) {
            const r1 = Math.random(), r2 = Math.random();
            this.velocity[i] = (w * this.velocity[i]) + (c1 * r1 * (this.pbest.position[i] - this.position[i])) + (c2 * r2 * (gbestPosition[i] - this.position[i]));
            this.position[i] += this.velocity[i];
            this.position[i] = Math.max(0, Math.min(1, this.position[i])); // Clamp
        }
    }
}

// --- Initialization ---
function init() {
    populateFilterCheckboxes();
    updateButtonStates();
    setupEventListeners();
    const cvReadyCheck = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            clearInterval(cvReadyCheck);
            $statusText.text("Ready. Please select an image to begin.");
            $('#image-upload').prop('disabled', false);
        }
    }, 100);
}

function populateFilterCheckboxes() {
    Object.entries(ALL_FILTERS).forEach(([value, { name }]) => {
        $filterCheckboxesContainer.append(`<div class="form-check"><input class="form-check-input" type="checkbox" value="${value}" id="cb-${value}" checked><label class="form-check-label" for="cb-${value}">${name}</label></div>`);
    });
}

function setupEventListeners() {
    // Real-time slider value updates
    ['#num-images-slider', '#preview-size-slider', '#inertia-slider', '#cognition-slider', '#social-slider'].forEach(id => {
        $(id).on('input', e => $(e.currentTarget).parent().find('span').text($(e.currentTarget).val()));
    });

    // Real-time preview resizing
    $('#preview-size-slider').on('input', e => {
        if (!originalImage || $imageGrid.children().length === 0) return;
        const newWidth = originalImage.width * (parseInt($(e.currentTarget).val()) / 100);
        $('.thumbnail').css('width', `${newWidth}px`);
    });
    
    // Population size change handler
    $('#num-images-slider').on('change', handlePopulationChange);

    // Buttons and File Input
    $('#image-upload').on('change', handleImageUpload);
    $('#select-all-filters, #select-none-filters').on('click', handleFilterSelection);
    $('#try-again-btn').on('click', () => runEvolution(false));
    $('#reset-btn').on('click', handleReset);
    $('#cancel-processing-btn').on('click', () => { isProcessing = false; });
    $historyDropdown.on('change', loadFromHistory);
    $('#compare-btn').on('click', showCompareModal);
    $('#save-btn').on('click', saveSelectedImages);

    $imageGrid.on('click', '.thumbnail-container', function() {
        $(this).find('.thumbnail').toggleClass('selected');
        updateButtonStates();
    });
    $(window).on('beforeunload', () => pageIsDirty ? "You have unsaved changes. Are you sure you want to leave?" : undefined);
}

// --- Image Handling & Failsafes ---
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert("Invalid file type. Please select an image.");
        return;
    }
    const reader = new FileReader();
    reader.onload = event => {
        originalImage = new Image();
        originalImage.onload = () => {
            try {
                if (srcMat) srcMat.delete(); // Cleanup previous image
                srcMat = cv.imread(originalImage);
                if (srcMat.empty()) throw new Error("OpenCV could not read the image.");
                pageIsDirty = true;
                handleReset(true); // Perform a full reset on new image
            } catch (error) {
                alert(`Error processing image: ${error}. Please try a different image or check the console.`);
                console.error(error);
            }
        };
        originalImage.onerror = () => alert("Could not load the selected image file.");
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function handleFilterSelection(e) {
    $('#filter-checkboxes input').prop('checked', e.currentTarget.id === 'select-all-filters');
}

function handlePopulationChange() {
    if (isProcessing || population.length === 0) return;
    const newSize = parseInt($('#num-images-slider').val());
    const oldSize = population.length;
    const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    
    if (newSize > oldSize) {
        for (let i = 0; i < newSize - oldSize; i++) {
            population.push(new Particle(availableFilters));
        }
    } else if (newSize < oldSize) {
        population = population.slice(0, newSize);
    }
    $statusText.text(`Population size set to ${newSize}. This will take effect on the next evolution.`);
}

function handleReset(isNewImage = false) {
    if (!isNewImage && !confirm("Are you sure you want to reset? This will clear all history.")) {
        return;
    }
    history = [];
    $historyDropdown.html('<option>History</option>').val("History");
    runEvolution(true);
}

// --- Asynchronous Evolution on Main Thread ---
async function runEvolution(isReset) {
    if (!srcMat || isProcessing) return;
    
    isProcessing = true;
    updateButtonStates();
    const startTime = performance.now();
    startTimer(startTime);
    showOverlay("Initializing...", "0.0s", calculateETA());
    
    await new Promise(resolve => setTimeout(resolve, 50));

    const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    if (availableFilters.length === 0) {
        alert("Please select at least one filter type to use for evolution.");
        cancelProcessing(startTime); return;
    }

    if (isReset) {
        globalBest = null;
        const popSize = parseInt($('#num-images-slider').val());
        population = Array.from({ length: popSize }, () => new Particle(availableFilters));
    } else {
        updatePopulationState(availableFilters);
    }
    
    history.push(JSON.parse(JSON.stringify(population)));
    updateHistoryDropdown(history.length);

    await processAndRenderPopulation(population, `Processing Generation ${history.length}`);
    
    if (isProcessing) {
        pageIsDirty = true;
        $statusText.text(`Generation ${history.length} complete. Select your favorites and click 'Evolve'.`);
    } else {
        $statusText.text("Processing cancelled by user.");
    }
    cancelProcessing(startTime);
}

async function processAndRenderPopulation(pop, statusPrefix) {
    const allResults = [];
    $imageGrid.empty().height('auto');
    const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    
    for (let i = 0; i < pop.length; i++) {
        if (!isProcessing) break;
        const status = `${statusPrefix} (${i + 1}/${pop.length})`;
        $('#processing-status').text(status);
        
        const { resultMat, tooltip } = applyFilterSequence(pop[i].position, availableFilters);
        let canvas = document.createElement('canvas');
        cv.imshow(canvas, resultMat);
        allResults.push({ canvas: canvas, tooltip: tooltip });
        resultMat.delete();
        
        if (i % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (isProcessing) renderGrid(allResults);
}

function updatePopulationState(availableFilters) {
    const psoParams = {
        w: parseFloat($('#inertia-slider').val()),
        c1: parseFloat($('#cognition-slider').val()),
        c2: parseFloat($('#social-slider').val())
    };
    const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();

    if (selectedIndices.length > 0) {
        population.forEach((p, i) => {
            const fitness = selectedIndices.indexOf(i);
            p.fitness = (fitness !== -1) ? fitness : Infinity;
            if (p.fitness < p.pbest.fitness) {
                p.pbest.fitness = p.fitness;
                p.pbest.position = JSON.parse(JSON.stringify(p.position));
            }
        });
        const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
        if (fittestParticle) {
            if (!globalBest || fittestParticle.fitness < globalBest.fitness) {
                globalBest = JSON.parse(JSON.stringify(fittestParticle));
            }
        }
    } else {
        if (globalBest) {
            $statusText.text("Nothing selected, evolving based on previous best.");
        } else {
            $statusText.text("Nothing selected, re-shuffling population randomly.");
            population.forEach(p => new Particle(availableFilters));
            return; // Exit here to prevent updating based on a non-existent gbest
        }
    }
    // Evolve all particles toward the best position found
    population.forEach(p => p.update(globalBest.pbest.position, psoParams));
}

function cancelProcessing(startTime) {
    isProcessing = false;
    stopTimer(startTime);
    hideOverlay();
    updateButtonStates();
}

// --- Filter Application (Complete) ---
function applyFilterSequence(position, availableFilters) {
    let tempMat = srcMat.clone();
    let sequence = [];
    let gray;

    for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
        if (position[i * 3 + 2] > 0.5) {
            const filterIndex = Math.floor(position[i * 3 + 0] * availableFilters.length);
            const filterName = availableFilters[filterIndex];
            const normalizedValue = position[i * 3 + 1];
            if (filterName && ALL_FILTERS[filterName]) {
                const { min, max } = ALL_FILTERS[filterName];
                const value = min + (normalizedValue * (max - min));
                sequence.push({ op: filterName, val: value });
            }
        }
    }

    sequence.forEach(step => {
        try {
            switch(step.op) {
                case 'brightness': tempMat.convertTo(tempMat, -1, 1.0, step.val); break;
                case 'contrast': tempMat.convertTo(tempMat, -1, step.val, 0); break;
                case 'saturation': {
                    let hsv = new cv.Mat(); cv.cvtColor(tempMat, hsv, cv.COLOR_RGBA2RGB); cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
                    let planes = new cv.MatVector(); cv.split(hsv, planes); let s = planes.get(1);
                    s.convertTo(s, -1, step.val, 0); cv.merge(planes, hsv);
                    cv.cvtColor(hsv, tempMat, cv.COLOR_HSV2RGB); cv.cvtColor(tempMat, tempMat, cv.COLOR_RGB2RGBA);
                    hsv.delete(); planes.delete(); s.delete(); break;
                }
                case 'clahe': {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    let clahe = cv.createCLAHE(step.val, new cv.Size(8, 8)); clahe.apply(gray, gray);
                    cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0); clahe.delete(); gray.delete(); gray = null; break;
                }
                case 'blur': case 'median': {
                    let ksize = Math.floor(step.val / 2) * 2 + 1;
                    if (step.op === 'blur') cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0);
                    else cv.medianBlur(tempMat, tempMat, ksize); break;
                }
                case 'sharpen': {
                    if (step.val > 0.5) {
                        let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
                        cv.filter2D(tempMat, tempMat, -1, kernel); kernel.delete();
                    } break;
                }
                case 'denoise': cv.fastNlMeansDenoisingColored(tempMat, tempMat, step.val, step.val, 7, 21); break;
                case 'canny': {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    cv.Canny(gray, gray, step.val, step.val * 2); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
                    gray.delete(); gray = null; break;
                }
                case 'sobel': {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    let ksize = Math.floor(step.val / 2) * 2 + 1; let gradX = new cv.Mat(); let gradY = new cv.Mat();
                    cv.Sobel(gray, gradX, cv.CV_8U, 1, 0, ksize); cv.Sobel(gray, gradY, cv.CV_8U, 0, 1, ksize);
                    cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gray); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
                    gradX.delete(); gradY.delete(); gray.delete(); gray = null; break;
                }
                case 'erode': case 'dilate': {
                    let ksize = Math.floor(step.val); let kernel = cv.Mat.ones(ksize, ksize, cv.CV_8U);
                    if (step.op === 'erode') cv.erode(tempMat, tempMat, kernel); else cv.dilate(tempMat, tempMat, kernel);
                    kernel.delete(); break;
                }
                case 'threshold': {
                    cv.cvtColor(tempMat, tempMat, cv.COLOR_RGBA2GRAY);
                    cv.threshold(tempMat, tempMat, step.val, 255, cv.THRESH_BINARY);
                    cv.cvtColor(tempMat, tempMat, cv.COLOR_GRAY2RGBA); break;
                }
                case 'invert': { if (step.val > 0.5) cv.bitwise_not(tempMat, tempMat); break; }
            }
        } catch (err) { console.error(`Failed to apply filter ${step.op}:`, err); }
    });
    const tooltip = sequence.map(s => `${s.op}: ${s.val.toFixed(2)}`).join(' -> ') || "Original";
    return { resultMat: tempMat, tooltip: tooltip };
}

// --- History, UI, and State Management ---
async function loadFromHistory() {
    if (isProcessing) return;
    const selectedIndex = parseInt($historyDropdown.val());
    if (isNaN(selectedIndex)) return;
    
    isProcessing = true; // Prevent other actions during re-render
    const historicPopulation = JSON.parse(JSON.stringify(history[selectedIndex]));
    const statusPrefix = `Rendering Generation ${selectedIndex + 1}`;
    
    const startTime = performance.now();
    startTimer(startTime);
    showOverlay(statusPrefix, "0.0s", "...");
    await new Promise(resolve => setTimeout(resolve, 50));
    
    await processAndRenderPopulation(historicPopulation, statusPrefix);
    
    $statusText.text(`Viewing Generation ${selectedIndex + 1}. You can Evolve from this state or choose another from History.`);
    cancelProcessing(startTime); // Resets flags and timers
}

function updateHistoryDropdown(newLength) {
    const value = newLength - 1;
    $historyDropdown.append(`<option value="${value}">Generation ${newLength}</option>`);
    $historyDropdown.val(value);
}

function renderGrid(results) {
    $imageGrid.empty().height('auto');
    if (!originalImage) return;
    const newWidth = originalImage.width * (parseInt($('#preview-size-slider').val()) / 100);
    results.forEach((result, index) => {
        const container = $(`<div class="thumbnail-container" data-bs-toggle="tooltip" data-bs-placement="top" title="${result.tooltip}"></div>`);
        const img = $(`<img src="${result.canvas.toDataURL('image/webp', 0.8)}" class="thumbnail" data-index="${index}" style="width:${newWidth}px; height: auto;">`);
        container.append(img);
        $imageGrid.append(container);
    });
    $('[data-bs-toggle="tooltip"]').tooltip({ boundary: 'window', container: 'body' });
}

function showCompareModal() {
    const $modalArea = $('#modal-content-area').empty();
    const selected = $imageGrid.find('.thumbnail.selected').parent();
    if (selected.length === 0) return;

    let currentIndex = 0;
    const selectedData = selected.map(function() {
        return { src: $(this).find('img').attr('src'), caption: $(this).attr('data-bs-original-title') };
    }).get();
    
    $modalArea.html(`
        <div class="col-6 d-flex flex-column align-items-center">
            <h5>Original</h5>
            <img src="${originalImage.src}" class="img-fluid rounded" style="max-height: 85vh; object-fit: contain;">
        </div>
        <div class="col-6 d-flex flex-column align-items-center position-relative">
            <h5 id="compare-caption-title">Selection 1/${selectedData.length}</h5>
            <img id="compare-image" src="${selectedData[0].src}" class="img-fluid rounded" style="max-height: 85vh; object-fit: contain;">
            <p id="compare-caption" class="figure-caption mt-1 text-center" style="white-space: pre-wrap;">${selectedData[0].caption}</p>
            <i class="bi bi-arrow-left-circle-fill position-absolute top-50 start-0 translate-middle-y fs-2" id="compare-prev" style="cursor: pointer;"></i>
            <i class="bi bi-arrow-right-circle-fill position-absolute top-50 end-0 translate-middle-y fs-2" id="compare-next" style="cursor: pointer;"></i>
        </div>
    `);

    const updateCompareImage = () => {
        $('#compare-image').attr('src', selectedData[currentIndex].src);
        $('#compare-caption').text(selectedData[currentIndex].caption);
        $('#compare-caption-title').text(`Selection ${currentIndex + 1}/${selectedData.length}`);
        $('#compare-prev').toggle(currentIndex > 0);
        $('#compare-next').toggle(currentIndex < selectedData.length - 1);
    };

    $('#compare-prev').on('click', () => { if(currentIndex > 0) { currentIndex--; updateCompareImage(); } });
    $('#compare-next').on('click', () => { if(currentIndex < selectedData.length - 1) { currentIndex++; updateCompareImage(); } });

    updateCompareImage();
    compareModal.show();
}

async function saveSelectedImages() {
    $statusText.text("Zipping images...");
    const zip = new JSZip();
    const folderName = `Imager-Evo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const imgFolder = zip.folder(folderName);
    let manifest = "";
    const promises = [];
    $('.thumbnail.selected').each(function(i) {
        const $this = $(this);
        const imageName = `image-${i + 1}.png`;
        const tooltip = $this.parent().attr('data-bs-original-title');
        manifest += `${imageName}\n--------------------\n${tooltip}\n\n`;
        const dataUrl = $this.attr('src');
        promises.push(fetch(dataUrl).then(res => res.blob()).then(blob => imgFolder.file(imageName, blob)));
    });
    await Promise.all(promises);
    imgFolder.file("manifest.txt", manifest);
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `${folderName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    $statusText.text("Download complete.");
}

// --- UI State, History, and Timers ---
function updateButtonStates() {
    const imageLoaded = !!originalImage;
    const anySelected = $imageGrid.find('.thumbnail.selected').length > 0;
    if (isProcessing) {
        $('button, input').not('#cancel-processing-btn').prop('disabled', true);
        return;
    }
    $('button, input').prop('disabled', false);
    $('#image-upload').prop('disabled', typeof cv === 'undefined');
    if (!imageLoaded) {
        $('#try-again-btn, #reset-btn, #prev-btn, #next-btn, #compare-btn, #save-btn').prop('disabled', true);
    } else {
        $('#compare-btn, #save-btn').prop('disabled', !anySelected);
        $('#prev-btn').prop('disabled', currentHistoryIndex <= 0);
        $('#next-btn').prop('disabled', currentHistoryIndex >= history.length - 1);
    }
}

function showOverlay(status, time, eta) {
    $('#processing-status').text(status);
    $('#processing-timer').text(`Time elapsed: ${time}`);
    $('#processing-eta').text(`ETA: ${eta}`);
    $overlay.removeClass('d-none');
}

function hideOverlay() { $overlay.addClass('d-none'); }

function startTimer(startTime) {
    timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        $('#processing-timer').text(`Time elapsed: ${elapsed}s`);
        $statusText.text($('#processing-status').text());
    }, 100);
}

function stopTimer(startTime) {
    clearInterval(timerInterval);
    if (!isProcessing) return; // Don't record time if cancelled
    const totalTime = (performance.now() - startTime) / 1000;
    generationTimes.push(totalTime);
}

function calculateETA() {
    if (generationTimes.length === 0) return "calculating...";
    const avgTime = generationTimes.reduce((a, b) => a + b, 0) / generationTimes.length;
    return `~${avgTime.toFixed(1)}s`;
}

// Start the application
init();

// // A $(document).ready() block is not needed because the script is deferred.
// // The DOM will be fully ready when this script executes.

// // --- Configuration ---
// const ALL_FILTERS = {
//     brightness: { min: -100, max: 100, name: "Brightness" },
//     contrast: { min: 1.0, max: 3.0, name: "Contrast" },
//     saturation: { min: 0.0, max: 3.0, name: "Saturation" },
//     clahe: { min: 1.0, max: 10.0, name: "CLAHE" },
//     blur: { min: 1, max: 15, name: "Blur" },
//     median: { min: 3, max: 15, name: "Median" },
//     sharpen: { min: 0, max: 1, name: "Sharpen" },
//     denoise: { min: 1, max: 21, name: "Denoise" },
//     canny: { min: 20, max: 100, name: "Canny Edges" },
//     sobel: { min: 1, max: 5, name: "Sobel Edges" },
//     erode: { min: 1, max: 9, name: "Erode" },
//     dilate: { min: 1, max: 9, name: "Dilate" },
//     threshold: { min: 50, max: 200, name: "Threshold" },
//     invert: { min: 0, max: 1, name: "Invert" },
// };
// const MAX_FILTER_CHAIN_LENGTH = 8;

// // --- State Variables ---
// let originalImage = null, srcMat = null, population = [], history = [];
// let globalBest = null, isProcessing = false, pageIsDirty = false;
// let timerInterval, generationTimes = [];

// // --- DOM Elements ---
// const $statusText = $('#status-text'), $imageGrid = $('#image-grid'), $overlay = $('#processing-overlay');
// const $filterCheckboxesContainer = $('#filter-checkboxes');
// const $historyDropdown = $('#history-dropdown');
// const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

// // --- Particle Class for Dynamic Filter Chains ---
// class Particle {
//     constructor(availableFilters) {
//         this.position = []; this.velocity = [];
//         this.pbest = { position: [], fitness: Infinity };
//         this.fitness = Infinity;
//         for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
//             this.position.push(Math.random(), Math.random(), Math.random()); // [filter_type, filter_value, is_active]
//             this.velocity.push(0, 0, 0);
//         }
//     }
//     update(gbestPosition, psoParams) {
//         const { w, c1, c2 } = psoParams;
//         for (let i = 0; i < this.position.length; i++) {
//             const r1 = Math.random(), r2 = Math.random();
//             this.velocity[i] = (w * this.velocity[i]) +
//                               (c1 * r1 * (this.pbest.position[i] - this.position[i])) +
//                               (c2 * r2 * (gbestPosition[i] - this.position[i]));
//             this.position[i] += this.velocity[i];
//             this.position[i] = Math.max(0, Math.min(1, this.position[i])); // Clamp
//         }
//     }
// }

// // --- Initialization ---
// function init() {
//     populateFilterCheckboxes();
//     updateButtonStates();
//     setupEventListeners();
//     const cvReadyCheck = setInterval(() => {
//         if (typeof cv !== 'undefined' && cv.getBuildInformation) {
//             clearInterval(cvReadyCheck);
//             $statusText.text("Ready. Please select an image to begin.");
//             $('#image-upload').prop('disabled', false);
//         }
//     }, 100);
// }

// function populateFilterCheckboxes() {
//     Object.entries(ALL_FILTERS).forEach(([value, { name }]) => {
//         $filterCheckboxesContainer.append(`<div class="form-check"><input class="form-check-input" type="checkbox" value="${value}" id="cb-${value}" checked><label class="form-check-label" for="cb-${value}">${name}</label></div>`);
//     });
// }

// function setupEventListeners() {
//     // Real-time slider value updates
//     ['#num-images-slider', '#preview-size-slider', '#inertia-slider', '#cognition-slider', '#social-slider'].forEach(id => {
//         $(id).on('input', e => $(e.currentTarget).parent().find('span').text($(e.currentTarget).val()));
//     });

//     // Real-time preview resizing
//     $('#preview-size-slider').on('input', e => {
//         if (!originalImage) return;
//         const newWidth = originalImage.width * (parseInt($(e.currentTarget).val()) / 100);
//         $('.thumbnail').css('width', `${newWidth}px`);
//     });
    
//     // Population size change handler
//     $('#num-images-slider').on('change', handlePopulationChange);

//     // Buttons and File Input
//     $('#image-upload').on('change', handleImageUpload);
//     $('#select-all-filters, #select-none-filters').on('click', handleFilterSelection);
//     $('#try-again-btn').on('click', () => runEvolution(false));
//     $('#reset-btn').on('click', handleReset);
//     $('#cancel-processing-btn').on('click', () => { isProcessing = false; });
//     $historyDropdown.on('change', loadFromHistory);
//     $('#compare-btn').on('click', showCompareModal);
//     $('#save-btn').on('click', saveSelectedImages);

//     $imageGrid.on('click', '.thumbnail-container', function() {
//         $(this).find('.thumbnail').toggleClass('selected');
//         updateButtonStates();
//     });
//     $(window).on('beforeunload', () => pageIsDirty ? "You have unsaved changes. Are you sure you want to leave?" : undefined);
// }

// // --- Image Handling & Failsafes ---
// function handleImageUpload(e) {
//     const file = e.target.files[0];
//     if (!file) return;
//     if (!file.type.startsWith('image/')) {
//         alert("Invalid file type. Please select an image.");
//         return;
//     }
//     const reader = new FileReader();
//     reader.onload = e => {
//         originalImage = new Image();
//         originalImage.onload = () => {
//             try {
//                 if (srcMat) srcMat.delete(); // Cleanup
//                 srcMat = cv.imread(originalImage);
//                 if (srcMat.empty()) throw new Error("OpenCV could not read the image.");
//                 pageIsDirty = true;
//                 runEvolution(true);
//             } catch (error) {
//                 alert(`Error processing image: ${error}. Please try a different image.`);
//                 console.error(error);
//             }
//         };
//         originalImage.onerror = () => alert("Could not load image file.");
//         originalImage.src = e.target.result;
//     };
//     reader.readAsDataURL(file);
// }


// function handleFilterSelection(e) {
//     $('#filter-checkboxes input').prop('checked', e.currentTarget.id === 'select-all-filters');
// }

// function handlePopulationChange() {
//     if (isProcessing || population.length === 0) return;
//     const newSize = parseInt($('#num-images-slider').val());
//     const oldSize = population.length;
//     const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    
//     if (newSize > oldSize) {
//         for (let i = 0; i < newSize - oldSize; i++) {
//             population.push(new Particle(availableFilters));
//         }
//     } else if (newSize < oldSize) {
//         population = population.slice(0, newSize);
//     }
//     // No re-render, will take effect on next evolution
//     $statusText.text(`Population size set to ${newSize}.`);
// }

// function handleReset() {
//     if (confirm("Are you sure you want to reset? This will clear all history.")) {
//         history = [];
//         $historyDropdown.html('<option>History</option>'); // Reset dropdown
//         runEvolution(true);
//     }
// }

// // --- Asynchronous Evolution on Main Thread ---
// async function runEvolution(isReset) {
//     if (!srcMat || isProcessing) return;
//     isProcessing = true;
//     updateButtonStates();
//     const startTime = performance.now();
//     startTimer(startTime);
//     showOverlay("Initializing...", "0.0s", calculateETA());
//     await new Promise(resolve => setTimeout(resolve, 50));

//     const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
//     if (availableFilters.length === 0) {
//         alert("Please select at least one filter type.");
//         cancelProcessing(startTime); return;
//     }

//     if (isReset) {
//         globalBest = null;
//         const popSize = parseInt($('#num-images-slider').val());
//         population = Array.from({ length: popSize }, () => new Particle(availableFilters));
//     } else {
//         updatePopulationState(availableFilters);
//     }
    
//     history.push(JSON.parse(JSON.stringify(population)));
//     updateHistoryDropdown(history.length);

//     await processAndRenderPopulation(population, `Processing Generation ${history.length}...`);
    
//     if (isProcessing) {
//         pageIsDirty = true;
//         $statusText.text(`Generation ${history.length} complete. Select favorites and 'Evolve'.`);
//     } else {
//         $statusText.text("Processing cancelled by user.");
//     }
//     cancelProcessing(startTime);
// }

// async function processAndRenderPopulation(pop, statusPrefix) {
//     const allResults = [];
//     $imageGrid.empty().height('auto');

//     for (let i = 0; i < pop.length; i++) {
//         if (!isProcessing) break;
//         const status = `${statusPrefix} (${i + 1}/${pop.length})`;
//         $statusText.text(status);
//         $('#processing-status').text(status);
//         const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
//         const { resultMat, tooltip } = applyFilterSequence(pop[i].position, availableFilters);
//         let canvas = document.createElement('canvas');
//         cv.imshow(canvas, resultMat);
//         allResults.push({ canvas: canvas, tooltip: tooltip });
//         resultMat.delete();
//         if (i % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
//     }
//     if (isProcessing) renderGrid(allResults);
// }

// function updatePopulationState(availableFilters) {
//     const psoParams = {
//         w: parseFloat($('#inertia-slider').val()),
//         c1: parseFloat($('#cognition-slider').val()),
//         c2: parseFloat($('#social-slider').val())
//     };
//     const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();

//     if (selectedIndices.length > 0) {
//         population.forEach((p, i) => {
//             const fitness = selectedIndices.indexOf(i);
//             p.fitness = (fitness !== -1) ? fitness : Infinity;
//             if (p.fitness < p.pbest.fitness) {
//                 p.pbest.fitness = p.fitness;
//                 p.pbest.position = JSON.parse(JSON.stringify(p.position));
//             }
//         });
//         const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
//         if (fittestParticle && (!globalBest || fittestParticle.fitness < globalBest.fitness)) {
//             globalBest = JSON.parse(JSON.stringify(fittestParticle));
//         }
//     } else {
//         if (globalBest) {
//             $statusText.text("Nothing selected, evolving based on previous best.");
//         } else {
//             $statusText.text("Nothing selected, re-shuffling population randomly.");
//             population.forEach(p => p = new Particle(availableFilters));
//             return;
//         }
//     }
//     population.forEach(p => p.update(globalBest.pbest.position, psoParams, availableFilters));
// }


// // --- Filter Application (Complete) ---
// function applyFilterSequence(position, availableFilters) {
//     let tempMat = srcMat.clone();
//     let sequence = [];
//     let gray; // Lazily initialized grayscale matrix

//     for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
//         if (position[i * 3 + 2] > 0.5) { // Is this step active?
//             const filterIndex = Math.floor(position[i * 3 + 0] * availableFilters.length);
//             const filterName = availableFilters[filterIndex];
//             const normalizedValue = position[i * 3 + 1];
//             if (filterName && ALL_FILTERS[filterName]) {
//                 const { min, max } = ALL_FILTERS[filterName];
//                 const value = min + (normalizedValue * (max - min));
//                 sequence.push({ op: filterName, val: value });
//             }
//         }
//     }

//     // Apply the constructed sequence
//     sequence.forEach(step => {
//         try {
//             switch(step.op) {
//                 case 'brightness': tempMat.convertTo(tempMat, -1, 1.0, step.val); break;
//                 case 'contrast': tempMat.convertTo(tempMat, -1, step.val, 0); break;
//                 case 'saturation': {
//                     let hsv = new cv.Mat();
//                     cv.cvtColor(tempMat, hsv, cv.COLOR_RGBA2RGB); cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
//                     let hsvPlanes = new cv.MatVector(); cv.split(hsv, hsvPlanes);
//                     let s = hsvPlanes.get(1); s.convertTo(s, -1, step.val, 0);
//                     cv.merge(hsvPlanes, hsv);
//                     cv.cvtColor(hsv, tempMat, cv.COLOR_HSV2RGB); cv.cvtColor(tempMat, tempMat, cv.COLOR_RGB2RGBA);
//                     hsv.delete(); hsvPlanes.delete(); s.delete();
//                     break;
//                 }
//                 case 'clahe': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     let clahe = cv.createCLAHE(step.val, new cv.Size(8, 8));
//                     clahe.apply(gray, gray);
//                     cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
//                     clahe.delete(); gray.delete(); gray = null;
//                     break;
//                 }
//                 case 'blur': case 'median': {
//                     let ksize = Math.floor(step.val / 2) * 2 + 1;
//                     if (step.op === 'blur') cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
//                     else cv.medianBlur(tempMat, tempMat, ksize);
//                     break;
//                 }
//                 case 'sharpen': {
//                     let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
//                     cv.filter2D(tempMat, tempMat, -1, kernel); kernel.delete();
//                     break;
//                 }
//                 case 'denoise': cv.fastNlMeansDenoisingColored(tempMat, tempMat, step.val, step.val, 7, 21); break;
//                 case 'canny': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     cv.Canny(gray, gray, step.val, step.val * 2);
//                     cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
//                     gray.delete(); gray = null;
//                     break;
//                 }
//                 case 'sobel': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     let ksize = Math.floor(step.val / 2) * 2 + 1;
//                     let gradX = new cv.Mat(); let gradY = new cv.Mat();
//                     cv.Sobel(gray, gradX, cv.CV_8U, 1, 0, ksize); cv.Sobel(gray, gradY, cv.CV_8U, 0, 1, ksize);
//                     cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gray);
//                     cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
//                     gradX.delete(); gradY.delete(); gray.delete(); gray = null;
//                     break;
//                 }
//                 case 'erode': case 'dilate': {
//                     let ksize = Math.floor(step.val);
//                     let kernel = cv.Mat.ones(ksize, ksize, cv.CV_8U);
//                     if (step.op === 'erode') cv.erode(tempMat, tempMat, kernel);
//                     else cv.dilate(tempMat, tempMat, kernel);
//                     kernel.delete();
//                     break;
//                 }
//                 case 'threshold': {
//                     cv.cvtColor(tempMat, tempMat, cv.COLOR_RGBA2GRAY);
//                     cv.threshold(tempMat, tempMat, step.val, 255, cv.THRESH_BINARY);
//                     cv.cvtColor(tempMat, tempMat, cv.COLOR_GRAY2RGBA);
//                     break;
//                 }
//                 case 'invert': cv.bitwise_not(tempMat, tempMat); break;
//             }
//         } catch (err) { console.error(`Failed to apply filter ${step.op}:`, err); }
//     });

//     const tooltip = sequence.map(s => `${s.op}: ${s.val.toFixed(2)}`).join(' -> ') || "Original";
//     return { resultMat: tempMat, tooltip: tooltip };
// }

// // --- History, UI, and State Management ---
// function loadFromHistory() {
//     if (isProcessing) return;
//     const selectedIndex = parseInt($historyDropdown.val());
//     if (isNaN(selectedIndex)) return;
//     $statusText.text(`Loading Generation ${selectedIndex + 1} from history...`);
//     const historicPopulation = JSON.parse(JSON.stringify(history[selectedIndex]));
//     processAndRenderPopulation(historicPopulation, `Rendering Generation ${selectedIndex + 1}`);
//     $statusText.text(`Viewing Generation ${selectedIndex + 1}. You can Evolve from here or choose another from History.`);
// }

// function updateHistoryDropdown(newLength) {
//     const value = newLength - 1;
//     $historyDropdown.append(`<option value="${value}">Generation ${newLength}</option>`);
//     $historyDropdown.val(value);
// }

// function renderGrid(results) {
//     $imageGrid.empty().height('auto');
//     const previewRatio = parseInt($('#preview-size-slider').val()) / 100;
//     const isMobile = window.innerWidth < 768;
//     const baseSize = isMobile ? 90 : 120;
//     const size = Math.max(50, baseSize + (baseSize * previewRatio));

//     results.forEach((result, index) => {
//         const container = $(`<div class="thumbnail-container" data-bs-toggle="tooltip" data-bs-placement="top" title="${result.tooltip}"></div>`);
//         const img = $(`<img src="${result.canvas.toDataURL('image/webp', 0.8)}" class="thumbnail" data-index="${index}" style="width:${size}px; height:${size}px;">`);
//         container.append(img);
//         $imageGrid.append(container);
//     });
//     $('[data-bs-toggle="tooltip"]').tooltip({ boundary: 'window', container: 'body' });
// }


// function showCompareModal() {
//     const $modalArea = $('#modal-content-area').empty();
//     const selected = $imageGrid.find('.thumbnail.selected').parent();
//     if (selected.length === 0) return;

//     let currentIndex = 0;
//     const selectedData = selected.map(function() {
//         return { src: $(this).find('img').attr('src'), caption: $(this).attr('data-bs-original-title') };
//     }).get();
    
//     $modalArea.html(`
//         <div class="col-6 d-flex flex-column align-items-center">
//             <h5>Original</h5>
//             <img src="${originalImage.src}" class="img-fluid rounded" style="max-height: 85vh; object-fit: contain;">
//         </div>
//         <div class="col-6 d-flex flex-column align-items-center position-relative">
//             <h5 id="compare-caption-title">Selection 1/${selectedData.length}</h5>
//             <img id="compare-image" src="${selectedData[0].src}" class="img-fluid rounded" style="max-height: 85vh; object-fit: contain;">
//             <p id="compare-caption" class="figure-caption mt-1 text-center" style="white-space: pre-wrap;">${selectedData[0].caption}</p>
//             <i class="bi bi-arrow-left-circle-fill position-absolute top-50 start-0 translate-middle-y fs-2" id="compare-prev" style="cursor: pointer;"></i>
//             <i class="bi bi-arrow-right-circle-fill position-absolute top-50 end-0 translate-middle-y fs-2" id="compare-next" style="cursor: pointer;"></i>
//         </div>
//     `);

//     const updateCompareImage = () => {
//         $('#compare-image').attr('src', selectedData[currentIndex].src);
//         $('#compare-caption').text(selectedData[currentIndex].caption);
//         $('#compare-caption-title').text(`Selection ${currentIndex + 1}/${selectedData.length}`);
//         $('#compare-prev').toggle(currentIndex > 0);
//         $('#compare-next').toggle(currentIndex < selectedData.length - 1);
//     };

//     $('#compare-prev').on('click', () => { if(currentIndex > 0) { currentIndex--; updateCompareImage(); } });
//     $('#compare-next').on('click', () => { if(currentIndex < selectedData.length - 1) { currentIndex++; updateCompareImage(); } });

//     updateCompareImage();
//     compareModal.show();
// }

// // --- UI State, History, and Timers ---
// function updateButtonStates() {
//     const imageLoaded = !!originalImage;
//     const anySelected = $imageGrid.find('.thumbnail.selected').length > 0;
//     if (isProcessing) {
//         $('button, input').not('#cancel-processing-btn').prop('disabled', true);
//         return;
//     }
//     $('button, input').prop('disabled', false);
//     $('#image-upload').prop('disabled', typeof cv === 'undefined');
//     if (!imageLoaded) {
//         $('#try-again-btn, #reset-btn, #prev-btn, #next-btn, #compare-btn, #save-btn').prop('disabled', true);
//     } else {
//         $('#compare-btn, #save-btn').prop('disabled', !anySelected);
//         $('#prev-btn').prop('disabled', currentHistoryIndex <= 0);
//         $('#next-btn').prop('disabled', currentHistoryIndex >= history.length - 1);
//     }
// }

// async function saveSelectedImages() {
//     $statusText.text("Zipping images...");
//     const zip = new JSZip();
//     const folderName = `Imager-Evo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
//     const imgFolder = zip.folder(folderName);
//     let manifest = "";
//     const promises = [];
//     $('.thumbnail.selected').each(function(i) {
//         const $this = $(this);
//         const imageName = `image-${i + 1}.png`;
//         const tooltip = $this.parent().attr('data-bs-original-title');
//         manifest += `${imageName}\n--------------------\n${tooltip}\n\n`;
//         const dataUrl = $this.attr('src');
//         promises.push(fetch(dataUrl).then(res => res.blob()).then(blob => imgFolder.file(imageName, blob)));
//     });
//     await Promise.all(promises);
//     imgFolder.file("manifest.txt", manifest);
//     const content = await zip.generateAsync({ type: "blob" });
//     const link = document.createElement('a');
//     link.href = URL.createObjectURL(content);
//     link.download = `${folderName}.zip`;
//     document.body.appendChild(link);
//     link.click();
//     document.body.removeChild(link);
//     $statusText.text("Download complete.");
// }

// // function showOverlay(status, time, eta) {
// //     $('#processing-status').text(status);
// //     $('#processing-timer').text(`Time elapsed: ${time}`);
// //     $('#processing-eta').text(`ETA: ${eta}`);
// //     $overlay.removeClass('d-none');
// // }

// // function hideOverlay() { $overlay.addClass('d-none'); }

// function startTimer(startTime) {
//     timerInterval = setInterval(() => {
//         const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
//         $('#processing-timer').text(`Time elapsed: ${elapsed}s`);
//         $statusText.text($('#processing-status').text());
//     }, 100);
// }

// function stopTimer(startTime) {
//     clearInterval(timerInterval);
//     if (!isProcessing) return; // Don't record time if cancelled
//     const totalTime = (performance.now() - startTime) / 1000;
//     generationTimes.push(totalTime);
// }

// function calculateETA() {
//     if (generationTimes.length === 0) return "calculating...";
//     const avgTime = generationTimes.reduce((a, b) => a + b, 0) / generationTimes.length;
//     return `~${avgTime.toFixed(1)}s`;
// }


// // Start the application
// init();


// // A $(document).ready() block is not needed because the script is deferred.
// // The DOM will be fully ready when this script executes.

// // --- Configuration ---
// const ALL_FILTERS = {
//     brightness: { min: -100, max: 100 }, contrast: { min: 1.0, max: 3.0 },
//     saturation: { min: 0.0, max: 3.0 }, clahe: { min: 1.0, max: 10.0 },
//     blur: { min: 1, max: 15 }, median: { min: 3, max: 15 },
//     sharpen: { min: 0, max: 1 }, denoise: { min: 1, max: 21 },
//     canny: { min: 20, max: 100 }, sobel: { min: 1, max: 5 },
//     erode: { min: 1, max: 9 }, dilate: { min: 1, max: 9 },
//     threshold: { min: 50, max: 200 }, invert: { min: 0, max: 1 },
// };
// const MAX_FILTER_CHAIN_LENGTH = 8; // Max number of filters in a sequence

// // --- State Variables ---
// let originalImage = null, srcMat = null, population = [], history = [], currentHistoryIndex = -1;
// let globalBest = null, isProcessing = false, pageIsDirty = false;
// let timerInterval, generationTimes = [];

// // --- DOM Elements ---
// const $statusText = $('#status-text'), $imageGrid = $('#image-grid'), $overlay = $('#processing-overlay');
// const $filterCheckboxesContainer = $('#filter-checkboxes');
// const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

// // --- New Particle Class for Dynamic Filter Chains ---
// class Particle {
//     constructor(availableFilters) {
//         this.position = []; // This will hold the filter chain 'recipe'
//         this.velocity = [];
//         this.pbest = { position: [], fitness: Infinity };
//         this.fitness = Infinity;

//         // Each step in the chain has 3 dimensions: [filter_type, filter_value, is_active]
//         for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
//             // Randomly pick a filter from the available list
//             const filterIndex = Math.floor(Math.random() * availableFilters.length);
//             // Position
//             this.position.push(filterIndex / availableFilters.length); // Dimension 1: Which filter? (normalized)
//             this.position.push(Math.random()); // Dimension 2: What value? (normalized 0-1)
//             this.position.push(Math.random()); // Dimension 3: Is this step active?
//             // Velocity
//             this.velocity.push(0, 0, 0);
//         }
//     }
//     update(gbestPosition, psoParams, availableFilters) {
//         const { w, c1, c2 } = psoParams;
//         for (let i = 0; i < this.position.length; i++) {
//             const r1 = Math.random(), r2 = Math.random();
//             // Standard PSO equations
//             this.velocity[i] = (w * this.velocity[i]) +
//                               (c1 * r1 * (this.pbest.position[i] - this.position[i])) +
//                               (c2 * r2 * (gbestPosition[i] - this.position[i]));
//             this.position[i] += this.velocity[i];
//             // Clamp position to [0, 1] range
//             this.position[i] = Math.max(0, Math.min(1, this.position[i]));
//         }
//     }
// }

// // --- Initialization ---
// function init() {
//     populateFilterCheckboxes();
//     updateButtonStates();
//     setupEventListeners();
    
//     // OpenCV readiness check
//     const cvReadyCheck = setInterval(() => {
//         if (typeof cv !== 'undefined' && cv.getBuildInformation) {
//             clearInterval(cvReadyCheck);
//             $statusText.text("Ready. Please select an image to begin.");
//             $('#image-upload').prop('disabled', false);
//         }
//     }, 100);
// }

// function populateFilterCheckboxes() {
//     Object.keys(ALL_FILTERS).forEach(value => {
//         const label = value.charAt(0).toUpperCase() + value.slice(1);
//         const checkboxHTML = `<div class="form-check"><input class="form-check-input" type="checkbox" value="${value}" id="cb-${value}" checked><label class="form-check-label" for="cb-${value}">${label}</label></div>`;
//         $filterCheckboxesContainer.append(checkboxHTML);
//     });
// }

// function setupEventListeners() {
//     // Sliders
//     ['#num-images-slider', '#preview-size-slider', '#inertia-slider', '#cognition-slider', '#social-slider'].forEach(id => {
//         $(id).on('input', e => $(e.currentTarget).parent().find('span').text($(e.currentTarget).val()));
//     });
//     // Buttons and File Input
//     $('#image-upload').on('change', handleImageUpload);
//     $('#select-all-filters, #select-none-filters').on('click', handleFilterSelection);
//     $('#try-again-btn').on('click', () => runEvolution(false));
//     $('#reset-btn').on('click', () => runEvolution(true));
//     $('#cancel-processing-btn').on('click', () => { isProcessing = false; }); // Set flag to stop async loop
//     $('#prev-btn').on('click', () => navigateHistory(-1));
//     $('#next-btn').on('click', () => navigateHistory(1));
//     $('#compare-btn').on('click', showCompareModal);
//     $('#save-btn').on('click', saveSelectedImages);
//     // Grid Selection
//     $imageGrid.on('click', '.thumbnail-container', function() {
//         $(this).find('.thumbnail').toggleClass('selected');
//         updateButtonStates();
//     });
//     // Unload Warning
//     $(window).on('beforeunload', () => pageIsDirty ? "You have unsaved changes. Are you sure you want to leave?" : undefined);
// }

// // --- Image Handling & Failsafes ---
// function handleImageUpload(e) {
//     const file = e.target.files[0];
//     if (!file) return;
//     if (!file.type.startsWith('image/')) {
//         alert("Invalid file type. Please select an image.");
//         return;
//     }
//     const reader = new FileReader();
//     reader.onload = e => {
//         originalImage = new Image();
//         originalImage.onload = () => {
//             try {
//                 if (srcMat) srcMat.delete(); // Cleanup
//                 srcMat = cv.imread(originalImage);
//                 if (srcMat.empty()) throw new Error("OpenCV could not read the image.");
//                 pageIsDirty = true;
//                 runEvolution(true);
//             } catch (error) {
//                 alert(`Error processing image: ${error}. Please try a different image.`);
//                 console.error(error);
//             }
//         };
//         originalImage.onerror = () => alert("Could not load image file.");
//         originalImage.src = e.target.result;
//     };
//     reader.readAsDataURL(file);
// }

// function handleFilterSelection(e) {
//     $('#filter-checkboxes input').prop('checked', e.currentTarget.id === 'select-all-filters');
// }

// // --- Asynchronous Evolution on Main Thread ---
// async function runEvolution(isReset) {
//     if (!srcMat || isProcessing) return;
    
//     isProcessing = true;
//     updateButtonStates();
//     const startTime = performance.now();
//     startTimer(startTime);
//     showOverlay("Initializing...", "0.0s", calculateETA());
    
//     // Yield to allow UI to update before heavy work
//     await new Promise(resolve => setTimeout(resolve, 50));

//     const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
//     if (availableFilters.length === 0) {
//         alert("Please select at least one filter type to use for evolution.");
//         cancelProcessing();
//         return;
//     }

//     if (isReset) {
//         history = []; currentHistoryIndex = -1; globalBest = null;
//         const popSize = parseInt($('#num-images-slider').val());
//         population = Array.from({ length: popSize }, () => new Particle(availableFilters));
//     } else {
//         updatePopulationState(availableFilters);
//     }
    
//     history.push(JSON.parse(JSON.stringify(population))); // Store pre-evolution state for this round
//     currentHistoryIndex++;

//     const allResults = [];
//     $imageGrid.empty().height(window.innerHeight * 0.5); // Prevent layout shifts

//     for (let i = 0; i < population.length; i++) {
//         if (!isProcessing) break; // Check for cancellation flag

//         const status = `Processing variant ${i + 1} of ${population.length}...`;
//         $statusText.text(status);
//         $('#processing-status').text(status);

//         const particle = population[i];
//         const { resultMat, tooltip } = applyFilterSequence(particle.position, availableFilters);
        
//         let canvas = document.createElement('canvas');
//         cv.imshow(canvas, resultMat);
//         allResults.push({ canvas: canvas, tooltip: tooltip });
//         resultMat.delete();
        
//         // Yield to the main thread every few images to keep UI responsive
//         if (i % 2 === 0) {
//             await new Promise(resolve => setTimeout(resolve, 0));
//         }
//     }

//     if (isProcessing) { // If not cancelled
//         renderGrid(allResults);
//         pageIsDirty = true;
//         $statusText.text(`Generation ${currentHistoryIndex + 1} complete. Select your favorites and click 'Evolve'.`);
//     } else {
//         $statusText.text("Processing cancelled by user.");
//     }

//     cancelProcessing(startTime); // Cleanup timers and flags
// }

// function updatePopulationState(availableFilters) {
//     const psoParams = {
//         w: parseFloat($('#inertia-slider').val()),
//         c1: parseFloat($('#cognition-slider').val()),
//         c2: parseFloat($('#social-slider').val())
//     };
//     const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();

//     if (selectedIndices.length > 0) {
//         population.forEach((p, i) => {
//             const fitness = selectedIndices.indexOf(i);
//             p.fitness = (fitness !== -1) ? fitness : Infinity;
//             if (p.fitness < p.pbest.fitness) {
//                 p.pbest.fitness = p.fitness;
//                 p.pbest.position = JSON.parse(JSON.stringify(p.position));
//             }
//         });
//         const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
//         if (fittestParticle && (!globalBest || fittestParticle.fitness < globalBest.fitness)) {
//             globalBest = JSON.parse(JSON.stringify(fittestParticle));
//         }
//     } else {
//         if (globalBest) {
//             $statusText.text("Nothing selected, evolving based on previous best.");
//         } else {
//             $statusText.text("Nothing selected, re-shuffling population randomly.");
//             population.forEach(p => p = new Particle(availableFilters));
//             return;
//         }
//     }
//     population.forEach(p => p.update(globalBest.pbest.position, psoParams, availableFilters));
// }

// function cancelProcessing(startTime) {
//     isProcessing = false;
//     stopTimer(startTime);
//     hideOverlay();
//     updateButtonStates();
// }

// // --- Filter Application and Rendering ---
// function applyFilterSequence(position, availableFilters) {
//     let tempMat = srcMat.clone();
//     let sequence = [];

//     for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
//         const isActive = position[i * 3 + 2] > 0.5; // Is this step active?
//         if (isActive) {
//             const filterIndex = Math.floor(position[i * 3 + 0] * availableFilters.length);
//             const filterName = availableFilters[filterIndex];
//             const normalizedValue = position[i * 3 + 1];
            
//             if (filterName && ALL_FILTERS[filterName]) {
//                 const { min, max } = ALL_FILTERS[filterName];
//                 const value = min + (normalizedValue * (max - min));
//                 sequence.push({ op: filterName, val: value });
//             }
//         }
//     }

//     // Apply the constructed sequence
//     sequence.forEach(step => {
//         // This is a simplified application. A full implementation would have all the cv. calls here.
//         // For brevity, we'll just show one as an example.
//         if (step.op === 'brightness') {
//             tempMat.convertTo(tempMat, -1, 1.0, step.val);
//         } else if (step.op === 'contrast') {
//             tempMat.convertTo(tempMat, -1, step.val, 0);
//         } else if (step.op === 'blur') {
//              let ksize = Math.floor(step.val / 2) * 2 + 1;
//              cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
//         }
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         // ... ALL OTHER OPENCV FILTER LOGIC WOULD GO HERE ...
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//     });

//     const tooltip = sequence.map(s => `${s.op}: ${s.val.toFixed(2)}`).join(' -> ') || "Original";
//     return { resultMat: tempMat, tooltip: tooltip };
// }

// function renderGrid(results) {
//     $imageGrid.empty().height('auto');
//     const previewRatio = parseInt($('#preview-size-slider').val()) / 100;
//     const isMobile = window.innerWidth < 768;
//     const baseSize = isMobile ? 90 : 120;
//     const size = Math.max(50, baseSize + (baseSize * previewRatio));

//     results.forEach((result, index) => {
//         const container = $(`<div class="thumbnail-container" data-bs-toggle="tooltip" data-bs-placement="top" title="${result.tooltip}"></div>`);
//         const img = $(`<img src="${result.canvas.toDataURL('image/webp', 0.8)}" class="thumbnail" data-index="${index}" style="width:${size}px; height:${size}px;">`);
//         container.append(img);
//         $imageGrid.append(container);
//     });
//     $('[data-bs-toggle="tooltip"]').tooltip({ boundary: 'window', container: 'body' });
// }

// // --- UI State, History, and Timers ---
// function updateButtonStates() {
//     const imageLoaded = !!originalImage;
//     const anySelected = $imageGrid.find('.thumbnail.selected').length > 0;
//     if (isProcessing) {
//         $('button, input').not('#cancel-processing-btn').prop('disabled', true);
//         return;
//     }
//     $('button, input').prop('disabled', false);
//     $('#image-upload').prop('disabled', typeof cv === 'undefined');
//     if (!imageLoaded) {
//         $('#try-again-btn, #reset-btn, #prev-btn, #next-btn, #compare-btn, #save-btn').prop('disabled', true);
//     } else {
//         $('#compare-btn, #save-btn').prop('disabled', !anySelected);
//         $('#prev-btn').prop('disabled', currentHistoryIndex <= 0);
//         $('#next-btn').prop('disabled', currentHistoryIndex >= history.length - 1);
//     }
// }

// function navigateHistory(direction) {
//     if (isProcessing) return;
//     const newIndex = currentHistoryIndex + direction;
//     if (newIndex >= 0 && newIndex < history.length) {
//         currentHistoryIndex = newIndex;
//         population = JSON.parse(JSON.stringify(history[currentHistoryIndex]));
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************        
//         // Re-run the processing for that historical population state
//         // This is complex, for now we just show a message. A full implementation
//         // would re-render the images from the stored 'population' state.
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************
//         //**********************************************************************************        
//         alert("History navigation needs re-rendering. This feature is simplified in this version.");
//         updateButtonStates();
//     }
// }

// function showCompareModal() {
//     const $modalArea = $('#modal-content-area').empty();
//     $modalArea.append(`<div class="col-md-4 text-center"><img src="${originalImage.src}" class="img-fluid rounded"><figcaption class="figure-caption mt-1">Original</figcaption></div>`);
//     $('.thumbnail.selected').each(function() {
//         const $this = $(this);
//         const tooltip = $this.parent().attr('data-bs-original-title');
//         $modalArea.append(`<div class="col-md-4 text-center"><img src="${$this.attr('src')}" class="img-fluid rounded"><figcaption class="figure-caption mt-1">${tooltip.replace(/\n/g, ', ')}</figcaption></div>`);
//     });
//     compareModal.show();
// }

// async function saveSelectedImages() {
//     $statusText.text("Zipping images...");
//     const zip = new JSZip();
//     const folderName = `Imager-Evo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
//     const imgFolder = zip.folder(folderName);
//     let manifest = "";
//     const promises = [];
//     $('.thumbnail.selected').each(function(i) {
//         const $this = $(this);
//         const imageName = `image-${i + 1}.png`;
//         const tooltip = $this.parent().attr('data-bs-original-title');
//         manifest += `${imageName}\n--------------------\n${tooltip}\n\n`;
//         const dataUrl = $this.attr('src');
//         promises.push(fetch(dataUrl).then(res => res.blob()).then(blob => imgFolder.file(imageName, blob)));
//     });
//     await Promise.all(promises);
//     imgFolder.file("manifest.txt", manifest);
//     const content = await zip.generateAsync({ type: "blob" });
//     const link = document.createElement('a');
//     link.href = URL.createObjectURL(content);
//     link.download = `${folderName}.zip`;
//     document.body.appendChild(link);
//     link.click();
//     document.body.removeChild(link);
//     $statusText.text("Download complete.");
// }

// function showOverlay(status, time, eta) {
//     $('#processing-status').text(status);
//     $('#processing-timer').text(`Time elapsed: ${time}`);
//     $('#processing-eta').text(`ETA: ${eta}`);
//     $overlay.removeClass('d-none');
// }

// function hideOverlay() { $overlay.addClass('d-none'); }

// function startTimer(startTime) {
//     timerInterval = setInterval(() => {
//         const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
//         $('#processing-timer').text(`Time elapsed: ${elapsed}s`);
//         $statusText.text($('#processing-status').text());
//     }, 100);
// }

// function stopTimer(startTime) {
//     clearInterval(timerInterval);
//     if (!isProcessing) return; // Don't record time if cancelled
//     const totalTime = (performance.now() - startTime) / 1000;
//     generationTimes.push(totalTime);
// }

// function calculateETA() {
//     if (generationTimes.length === 0) return "calculating...";
//     const avgTime = generationTimes.reduce((a, b) => a + b, 0) / generationTimes.length;
//     return `~${avgTime.toFixed(1)}s`;
// }

// // Start the application
// init();
