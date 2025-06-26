//TODO: ADD AN OPTION TO SELECT ANY DESIRED IMAGE MANIPULATION PIPELINE AND APPLY IT TO 
//MULTIPLE IMAGES ON DISK


// A $(document).ready() block is not needed because the script is deferred.

// --- Configuration ---
const ALL_FILTERS = {
    brightness: { min: -100, max: 100, name: "Brightness" },
    contrast: { min: 1.0, max: 3.0, name: "Contrast" },
    gamma: { min: 0.2, max: 3.0, name: "Gamma" },
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
const MAX_FILTER_CHAIN_LENGTH = 8;

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
        // The position vector holds the 'recipe' for the filter chain.
        // Each step has 3 dimensions: [filter_type, filter_value, is_active]
        // All values are normalized between 0 and 1 for the PSO algorithm.
        for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
            this.position.push(Math.random(), Math.random(), Math.random());
            this.velocity.push(0, 0, 0);
        }
    }
    update(gbestPosition, psoParams) {
        const { w, c1, c2 } = psoParams;
        for (let i = 0; i < this.position.length; i++) {
            const r1 = Math.random(), r2 = Math.random();
            // Standard PSO equations
            this.velocity[i] = (w * this.velocity[i]) + (c1 * r1 * (this.pbest.position[i] - this.position[i])) + (c2 * r2 * (gbestPosition[i] - this.position[i]));
            this.position[i] += this.velocity[i];
            // Clamp position to the normalized [0, 1] range. The actual filter values
            // are calculated from this normalized value when they are applied.
            this.position[i] = Math.max(0, Math.min(1, this.position[i]));
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
    // Sliders
    ['#num-images-slider', '#preview-size-slider', '#inertia-slider', '#cognition-slider', '#social-slider'].forEach(id => {
        $(id).on('input', e => $(e.currentTarget).parent().find('span').text($(e.currentTarget).val()));
    });
    // Real-time preview resizing
    $('#preview-size-slider').on('input', e => {
        if (!originalImage || $imageGrid.children().length === 0) return;
        const newWidth = originalImage.width * (parseInt($(e.currentTarget).val()) / 100);
        $('.thumbnail').css('width', `${newWidth}px`);
    });    
    $('#num-images-slider').on('change', handlePopulationChange);
    // Buttons, File Input, and History
    $('#image-upload').on('change', handleImageUpload);
    $filterCheckboxesContainer.on('change', 'input', updateButtonStates); // Update buttons when filters change
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
        // FIX: Sort by fitness before slicing to keep the best particles.
        population.sort((a, b) => a.fitness - b.fitness);
        population = population.slice(0, newSize);
    }
    $statusText.text(`Population size set to ${newSize}.`);
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
    
    // FIX: Store the full context for the generation in history
    history.push({
        population: JSON.parse(JSON.stringify(population)),
        psoParams: {
            inertia: $('#inertia-slider').val(),
            cognition: $('#cognition-slider').val(),
            social: $('#social-slider').val(),
        },
        previewSize: $('#preview-size-slider').val(),
        availableFilters: availableFilters
    });
    updateHistoryDropdown(history.length);

    await processAndRenderPopulation(population, `Processing Generation ${history.length}`, availableFilters);
    
    if (isProcessing) {
        pageIsDirty = true;
        $statusText.text(`Generation ${history.length} complete. Select your favorites and click 'Evolve'.`);
    } else {
        $statusText.text("Processing cancelled by user.");
    }
    cancelProcessing(startTime);
}

async function processAndRenderPopulation(pop, statusPrefix, filters) {
    const allResults = [];
    $imageGrid.empty().height('auto');
    
    for (let i = 0; i < pop.length; i++) {
        if (!isProcessing) break;
        const status = `${statusPrefix} (${i + 1}/${pop.length})`;
        $('#processing-status').text(status);
        
        const { resultMat, tooltip } = applyFilterSequence(pop[i].position, filters);
        let canvas = document.createElement('canvas');
        cv.imshow(canvas, resultMat);
        allResults.push({ canvas: canvas, tooltip: tooltip });
        resultMat.delete();
        
        if (i % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (isProcessing) renderGrid(allResults);
}

// --- Corrected PSO Evolution Logic ---
function updatePopulationState(availableFilters) {
    const psoParams = {
        w: parseFloat($('#inertia-slider').val()),
        c1: parseFloat($('#cognition-slider').val()),
        c2: parseFloat($('#social-slider').val())
    };
    const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();

    // Re-initialize unselected particles if the filter set has changed
    // This allows the swarm to adapt to new user constraints.
    population.forEach((p, i) => {
        const isSelected = selectedIndices.includes(i);
        if (!isSelected) {
            population[i] = new Particle(availableFilters);
        }
    });

    if (selectedIndices.length > 0) {
        // Calculate fitness for the selected particles
        population.forEach((p, i) => {
            const fitness = selectedIndices.indexOf(i);
            p.fitness = (fitness !== -1) ? fitness : Infinity;
            if (p.fitness < p.pbest.fitness) {
                p.pbest.fitness = p.fitness;
                p.pbest.position = JSON.parse(JSON.stringify(p.position));
            }
        });

        // Find the absolute best particle from the user's selection
        const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
        
        // Update the global best if the new best is better
        if (fittestParticle) {
             if (!globalBest || fittestParticle.fitness < globalBest.fitness) {
                globalBest = JSON.parse(JSON.stringify(fittestParticle));
            }
        }
    }
    
    if (!globalBest) {
        // If there's no global best yet (e.g., first "Evolve" with no selection),
        // we can't evolve. Just keep the re-initialized random particles.
        $statusText.text("No selection made. Evolving with new random variations.");
    } else {
        // Evolve ALL particles (both selected and newly randomized ones) toward the global best
        population.forEach(p => p.update(globalBest.pbest.position, psoParams));
    }
}

// --- Filter Application (Complete and Corrected) ---
function applyFilterSequence(position, availableFilters) {
    let tempMat = srcMat.clone();
    let sequence = [];
    const usedFilters = new Set(); // FIX: Ensure unique filters per chain

    for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
        if (position[i * 3 + 2] > 0.5) { // Is this step active?
            const filterIndex = Math.floor(position[i * 3 + 0] * availableFilters.length);
            const filterName = availableFilters[filterIndex];
            
            // FIX: Check if filter has already been used in this particle's chain
            if (filterName && !usedFilters.has(filterName)) {
                usedFilters.add(filterName);
                const normalizedValue = position[i * 3 + 1];
                const { min, max } = ALL_FILTERS[filterName];
                const value = min + (normalizedValue * (max - min));
                sequence.push({ op: filterName, val: value });
            }
        }
    }

    sequence.forEach(step => {
        try {
            switch(step.op) {
                case 'gamma': {
                    // FIX: Use a fast Look-Up Table (LUT) for gamma correction
                    if (step.val > 0) {
                        const gamma = 1.0 / step.val;
                        const lookUpTable = new Uint8Array(256);
                        for (let i = 0; i < 256; i++) {
                            lookUpTable[i] = Math.pow(i / 255.0, gamma) * 255;
                        }
                        let lutMat = cv.matFromArray(1, 256, cv.CV_8U, lookUpTable);
                        cv.LUT(tempMat, lutMat, tempMat);
                        lutMat.delete();
                    }
                    break;
                }
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
    const tooltip = sequence.map(s => `${s.op}: ${s.val.toFixed(2)}`).join(' -> ') || "Original (No Active Filters)";
    return { resultMat: tempMat, tooltip: tooltip };
}

// --- History, UI, and State Management ---
async function loadFromHistory() {
    if (isProcessing) return;
    const selectedIndex = parseInt($historyDropdown.val());
    if (isNaN(selectedIndex)) return;
    
    isProcessing = true; // Prevent other actions during re-render
    const historicState = history[selectedIndex];
    population = JSON.parse(JSON.stringify(historicState.population)); // Restore population
    
    // Restore settings from history
    $('#inertia-slider').val(historicState.psoParams.inertia).trigger('input');
    $('#cognition-slider').val(historicState.psoParams.cognition).trigger('input');
    $('#social-slider').val(historicState.psoParams.social).trigger('input');
    $('#preview-size-slider').val(historicState.previewSize).trigger('input');
    $('#filter-checkboxes input').each(function() {$(this).prop('checked', historicState.availableFilters.includes($(this).val()));});

    const statusPrefix = `Rendering Generation ${selectedIndex + 1}`;
    const startTime = performance.now();
    startTimer(startTime);
    showOverlay(statusPrefix, "0.0s", "...");
    await new Promise(resolve => setTimeout(resolve, 50));
    
    await processAndRenderPopulation(historicState.population, statusPrefix, historicState.availableFilters);
    
    $statusText.text(`Viewing Generation ${selectedIndex + 1}. You can Evolve from this state or choose another from History.`);
    cancelProcessing(startTime);
}

function cancelProcessing(startTime) {
    isProcessing = false;
    stopTimer(startTime);
    hideOverlay();
    updateButtonStates();
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


function updateButtonStates() {
    const imageLoaded = !!originalImage;
    const anySelected = $imageGrid.find('.thumbnail.selected').length > 0;
    const anyFilterSelected = $filterCheckboxesContainer.find('input:checked').length > 0;

    if (isProcessing) {
        $('button, input').not('#cancel-processing-btn').prop('disabled', true);
        return;
    }
    
    $('button, input').prop('disabled', false);
    $('#image-upload').prop('disabled', typeof cv === 'undefined' || isProcessing);
    
    if (!imageLoaded) {
        // Disable almost everything if no image is loaded
        $('#try-again-btn, #reset-btn, #history-dropdown, #compare-btn, #save-btn').prop('disabled', true);
    } else {
        // FIX: Also check if any filters are selected for evolution buttons
        $('#try-again-btn, #reset-btn').prop('disabled', !anyFilterSelected);
        $('#compare-btn, #save-btn').prop('disabled', !anySelected);
        $historyDropdown.prop('disabled', history.length === 0);
    }
}

// All other helper functions for timers and overlay are included here.

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
//     gamma: { min: 0.1, max: 3.0, name: "Gamma Correction" },
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
// const MAX_FILTER_CHAIN_LENGTH = 3; // Max number of filters in a sequence

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
//             this.velocity[i] = (w * this.velocity[i]) + (c1 * r1 * (this.pbest.position[i] - this.position[i])) + (c2 * r2 * (gbestPosition[i] - this.position[i]));
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
//         if (!originalImage || $imageGrid.children().length === 0) return;
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
//     reader.onload = event => {
//         originalImage = new Image();
//         originalImage.onload = () => {
//             try {
//                 if (srcMat) srcMat.delete(); // Cleanup previous image
//                 srcMat = cv.imread(originalImage);
//                 if (srcMat.empty()) throw new Error("OpenCV could not read the image.");
//                 pageIsDirty = true;
//                 handleReset(true); // Perform a full reset on new image
//             } catch (error) {
//                 alert(`Error processing image: ${error}. Please try a different image or check the console.`);
//                 console.error(error);
//             }
//         };
//         originalImage.onerror = () => alert("Could not load the selected image file.");
//         originalImage.src = event.target.result;
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
//     $statusText.text(`Population size set to ${newSize}. This will take effect on the next evolution.`);
// }

// function handleReset(isNewImage = false) {
//     if (!isNewImage && !confirm("Are you sure you want to reset? This will clear all history.")) {
//         return;
//     }
//     history = [];
//     $historyDropdown.html('<option>History</option>').val("History");
//     runEvolution(true);
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
//         alert("Please select at least one filter type to use for evolution.");
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

//     await processAndRenderPopulation(population, `Processing Generation ${history.length}`);
    
//     if (isProcessing) {
//         pageIsDirty = true;
//         $statusText.text(`Generation ${history.length} complete. Select your favorites and click 'Evolve'.`);
//     } else {
//         $statusText.text("Processing cancelled by user.");
//     }
//     cancelProcessing(startTime);
// }

// async function processAndRenderPopulation(pop, statusPrefix) {
//     const allResults = [];
//     $imageGrid.empty().height('auto');
//     const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    
//     for (let i = 0; i < pop.length; i++) {
//         if (!isProcessing) break;
//         const status = `${statusPrefix} (${i + 1}/${pop.length})`;
//         $('#processing-status').text(status);
        
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
//         if (fittestParticle) {
//             if (!globalBest || fittestParticle.fitness < globalBest.fitness) {
//                 globalBest = JSON.parse(JSON.stringify(fittestParticle));
//             }
//         }
//     } else {
//         if (globalBest) {
//             $statusText.text("Nothing selected, evolving based on previous best.");
//         } else {
//             $statusText.text("Nothing selected, re-shuffling population randomly.");
//             population.forEach(p => new Particle(availableFilters));
//             return; // Exit here to prevent updating based on a non-existent gbest
//         }
//     }
//     // Evolve all particles toward the best position found
//     population.forEach(p => p.update(globalBest.pbest.position, psoParams));
// }

// function cancelProcessing(startTime) {
//     isProcessing = false;
//     stopTimer(startTime);
//     hideOverlay();
//     updateButtonStates();
// }

// // --- Filter Application (Complete) ---
// function applyFilterSequence(position, availableFilters) {
//     let tempMat = srcMat.clone();
//     let sequence = [];
//     let gray;

//     for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
//         if (position[i * 3 + 2] > 0.5) {
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

//     sequence.forEach(step => {
//         try {
//             switch(step.op) {
//                 case 'brightness': tempMat.convertTo(tempMat, -1, 1.0, step.val); break;
//                 case 'contrast': tempMat.convertTo(tempMat, -1, step.val, 0); break;
//                 case 'gamma': {
//                     if (step.val > 0) {
//                         const { min, max } = ALL_FILTERS['gamma'];
//                         // Normalize step.val from [min, max] to [0, 1]
//                         const normalized = (step.val - min) / (max - min);
//                         // Now compute gamma correction
//                         let gammaCorrection = 1 / normalized; // or handle normalized == 0
//                         // To avoid division by zero
//                         if (normalized === 0) {
//                             gammaCorrection = 1; // or handle as default
//                         }
//                         // Apply gamma correction pixel-wise
//                         for (let y = 0; y < tempMat.rows; y++) {
//                             for (let x = 0; x < tempMat.cols; x++) {
//                                 let pixel = tempMat.ucharPtr(y, x);
//                                 for (let c = 0; c < 3; c++) {
//                                     let normalizedColor = pixel[c] / 255;
//                                     let corrected = Math.pow(normalizedColor, gammaCorrection);
//                                     pixel[c] = Math.min(255, Math.max(0, corrected * 255));
//                                 }
//                             }
//                         }
//                     }
//                     break;
//                 }              
//                 case 'saturation': {
//                     let hsv = new cv.Mat(); cv.cvtColor(tempMat, hsv, cv.COLOR_RGBA2RGB); cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
//                     let planes = new cv.MatVector(); cv.split(hsv, planes); let s = planes.get(1);
//                     s.convertTo(s, -1, step.val, 0); cv.merge(planes, hsv);
//                     cv.cvtColor(hsv, tempMat, cv.COLOR_HSV2RGB); cv.cvtColor(tempMat, tempMat, cv.COLOR_RGB2RGBA);
//                     hsv.delete(); planes.delete(); s.delete(); break;
//                 }
//                 case 'clahe': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     let clahe = cv.createCLAHE(step.val, new cv.Size(8, 8)); clahe.apply(gray, gray);
//                     cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0); clahe.delete(); gray.delete(); gray = null; break;
//                 }
//                 case 'blur': case 'median': {
//                     let ksize = Math.floor(step.val / 2) * 2 + 1;
//                     if (step.op === 'blur') cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0);
//                     else cv.medianBlur(tempMat, tempMat, ksize); break;
//                 }
//                 case 'sharpen': {
//                     if (step.val > 0.5) {
//                         let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
//                         cv.filter2D(tempMat, tempMat, -1, kernel); kernel.delete();
//                     } break;
//                 }
//                 case 'denoise': cv.fastNlMeansDenoisingColored(tempMat, tempMat, step.val, step.val, 7, 21); break;
//                 case 'canny': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     cv.Canny(gray, gray, step.val, step.val * 2); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
//                     gray.delete(); gray = null; break;
//                 }
//                 case 'sobel': {
//                     gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
//                     let ksize = Math.floor(step.val / 2) * 2 + 1; let gradX = new cv.Mat(); let gradY = new cv.Mat();
//                     cv.Sobel(gray, gradX, cv.CV_8U, 1, 0, ksize); cv.Sobel(gray, gradY, cv.CV_8U, 0, 1, ksize);
//                     cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gray); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
//                     gradX.delete(); gradY.delete(); gray.delete(); gray = null; break;
//                 }
//                 case 'erode': case 'dilate': {
//                     let ksize = Math.floor(step.val); let kernel = cv.Mat.ones(ksize, ksize, cv.CV_8U);
//                     if (step.op === 'erode') cv.erode(tempMat, tempMat, kernel); else cv.dilate(tempMat, tempMat, kernel);
//                     kernel.delete(); break;
//                 }
//                 case 'threshold': {
//                     cv.cvtColor(tempMat, tempMat, cv.COLOR_RGBA2GRAY);
//                     cv.threshold(tempMat, tempMat, step.val, 255, cv.THRESH_BINARY);
//                     cv.cvtColor(tempMat, tempMat, cv.COLOR_GRAY2RGBA); break;
//                 }
//                 case 'invert': { if (step.val > 0.5) cv.bitwise_not(tempMat, tempMat); break; }
//             }
//         } catch (err) { console.error(`Failed to apply filter ${step.op}:`, err); }
//     });
//     const tooltip = sequence.map(s => `${s.op}: ${s.val.toFixed(2)}`).join(' -> ') || "Original";
//     return { resultMat: tempMat, tooltip: tooltip };
// }

// // --- History, UI, and State Management ---
// async function loadFromHistory() {
//     if (isProcessing) return;
//     const selectedIndex = parseInt($historyDropdown.val());
//     if (isNaN(selectedIndex)) return;
    
//     isProcessing = true; // Prevent other actions during re-render
//     const historicPopulation = JSON.parse(JSON.stringify(history[selectedIndex]));
//     const statusPrefix = `Rendering Generation ${selectedIndex + 1}`;
    
//     const startTime = performance.now();
//     startTimer(startTime);
//     showOverlay(statusPrefix, "0.0s", "...");
//     await new Promise(resolve => setTimeout(resolve, 50));
    
//     await processAndRenderPopulation(historicPopulation, statusPrefix);
    
//     $statusText.text(`Viewing Generation ${selectedIndex + 1}. You can Evolve from this state or choose another from History.`);
//     cancelProcessing(startTime); // Resets flags and timers
// }

// function updateHistoryDropdown(newLength) {
//     const value = newLength - 1;
//     $historyDropdown.append(`<option value="${value}">Generation ${newLength}</option>`);
//     $historyDropdown.val(value);
// }

// function renderGrid(results) {
//     $imageGrid.empty().height('auto');
//     if (!originalImage) return;
//     const newWidth = originalImage.width * (parseInt($('#preview-size-slider').val()) / 100);
//     results.forEach((result, index) => {
//         const container = $(`<div class="thumbnail-container" data-bs-toggle="tooltip" data-bs-placement="top" title="${result.tooltip}"></div>`);
//         const img = $(`<img src="${result.canvas.toDataURL('image/webp', 0.8)}" class="thumbnail" data-index="${index}" style="width:${newWidth}px; height: auto;">`);
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
