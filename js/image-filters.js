//TODO: ADD AN OPTION TO SELECT ANY DESIRED IMAGE MANIPULATION PIPELINE AND APPLY IT TO 
//MULTIPLE IMAGES ON DISK

// How Infinity helps in fitness calculation: Infinity is used as a way to mark a particle as having a very bad fitness score.  It's a special value that's greater than any finite number.
// Problem Solved:  Imagine a scenario where a particle's fitness calculation could produce NaN (Not a Number) or a very large positive number (likely an error).  Without Infinity, these values would end up being sorted before particles with, say, a fitness score of 1.
// Exclusion: Using Infinity as an invalid fitness value allows you to explicitly exclude those particles. This prevents the sorting algorithm from incorrectly considering a broken or invalid particle.
// 10 - Infinity: The result is -Infinity.
// -1 - Infinity: The result is -Infinity.
// Infinity - Infinity: The result is NaN (Not a Number).

// A $(document).ready() block is not needed because the script is deferred.

// --- Configuration ---
const FILTER_DIMENSIONS = {
    TYPE: 0,    // Which filter to use from the available list (normalized)
    VALUE: 1,   // The filter's parameter value (normalized)
    ACTIVE: 2   // Whether this step in the chain is enabled (0-1)
};
const FILTER_ITEM_SIZE = Object.keys(FILTER_DIMENSIONS).length;
const BRIGHTNESS = 'Brightness'; const CONTRAST = 'Contrast'; const GAMMA = 'Gamma'; const SATURATION = 'Saturation'
const CLAHE = 'CLAHE'; const BLUR = 'Blur'; const MEDIAN = 'Median'; const SHARPEN = 'Sharpen'; const DENOISE = 'Denoise'
const CANNY = 'Canny'; const SOBEL = 'Sobel'; const ERODE = 'Erode'; const DILATE = 'Dilate'; const THRESHOLD = 'Threshold'
const INVERT = 'Invert';
const ALL_FILTERS = {
    [BRIGHTNESS]: { min: -100, max: 100, name: BRIGHTNESS },
    [CONTRAST]: { min: 1.0, max: 3.0, name: CONTRAST },
    [GAMMA]: { min: 0.2, max: 3.0, name: GAMMA },
    [SATURATION]: { min: 0.0, max: 3.0, name: SATURATION },
    [CLAHE]: { min: 1.0, max: 10.0, name: CLAHE },
    [BLUR]: { min: 1, max: 15, name: BLUR },
    [MEDIAN]: { min: 3, max: 15, name: MEDIAN },
    [SHARPEN]: { min: 0, max: 1, name: SHARPEN },
    [DENOISE]: { min: 1, max: 21, name: DENOISE },
    [CANNY]: { min: 20, max: 100, name: CANNY },
    [SOBEL]: { min: 1, max: 5, name: SOBEL },
    [ERODE]: { min: 1, max: 9, name: ERODE },
    [DILATE]: { min: 1, max: 9, name: DILATE },
    [THRESHOLD]: { min: 50, max: 200, name: THRESHOLD },
    [INVERT]: { min: 0, max: 1, name: INVERT },
};
const MAX_FILTER_CHAIN_LENGTH = 3;

// --- State Variables ---
let originalImage = null, srcMat = null, population = [], history = [];
let globalBest = null, isProcessing = false, pageIsDirty = false;
let timerInterval, generationTimes = [], statusLog = []; 

// --- DOM Elements ---
const $statusText = $('#status-text'), $imageGrid = $('#image-grid'), $overlay = $('#processing-overlay');
const $filterCheckboxesContainer = $('#filter-checkboxes');
const $historyDropdown = $('#history-dropdown');
const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

// --- Particle Class for Dynamic Filter Chains ---
// --- Particle Class for Dynamic Filter Chains ---
class Particle {
    constructor(availableFilters) {
        this.position = [];
        this.velocity = [];
        this.pbest = { position: [], fitness: Infinity };
        this.fitness = Infinity;

        // FIX: Improve initial diversity by attempting to assign unique filters
        const shuffledFilters = [...availableFilters].sort(() => 0.5 - Math.random());

        for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
            // Get a unique filter for this slot if possible, otherwise wrap around
            const filterName = shuffledFilters[i % shuffledFilters.length];
            const filterIndex = availableFilters.indexOf(filterName);
            
            // Initialize position for each dimension of a filter step
            this.position[i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.TYPE] = filterIndex / availableFilters.length;
            this.position[i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.VALUE] = Math.random();
            this.position[i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.ACTIVE] = Math.random();
            
            // Initialize velocity for each dimension
            for (let j = 0; j < FILTER_ITEM_SIZE; j++) {
                this.velocity.push(0);
            }
        }
    }

    update(gbestPosition, psoParams) {
        const { w, c1, c2 } = psoParams;
        for (let i = 0; i < this.position.length; i++) {
            const r1 = Math.random(), r2 = Math.random();
            // Standard PSO equations
            this.velocity[i] = (w * this.velocity[i]) +
                              (c1 * r1 * (this.pbest.position[i] - this.position[i])) +
                              (c2 * r2 * (gbestPosition[i] - this.position[i]));
            this.position[i] += this.velocity[i];
            
            // The PSO operates on a normalized [0, 1] space.
            // This clamping is correct. The specific value constraints for each
            // filter type are handled during the 'applyFilterSequence' step.
            this.position[i] = Math.max(0, Math.min(1, this.position[i]));
        }
    }
}

// --- Initialization ---
function init() {
    createLogModal(); // Create the hidden modal on page load
    populateFilterCheckboxes();
    updateButtonStates();
    setupEventListeners();
    const cvReadyCheck = setInterval(() => {//checks whether the OpenCV library (referred to as cv) has been loaded and is ready to use
        if (typeof cv !== 'undefined' && cv.getBuildInformation) {//checks if the cv object has the method getBuildInformation (which indicates that OpenCV has been fully initialized)
            clearInterval(cvReadyCheck);
            $statusText.text("Ready. Please select an image to begin.");
            $('#image-upload').prop('disabled', false);
        }
    }, 100);
}

function createLogModal() {
    const modalHTML = `
        <div class="modal fade" id="log-modal" tabindex="-1" aria-labelledby="logModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="logModalLabel">Status Log</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" id="log-modal-body">
                        </div>
                </div>
            </div>
        </div>`;
    $('body').append(modalHTML);
}

function populateFilterCheckboxes() {
    Object.entries(ALL_FILTERS).forEach(([value, { name }]) => {
        const isChecked = (name === GAMMA || name === BRIGHTNESS || name === CONTRAST) ? 'checked' : '';
        $filterCheckboxesContainer.append(`<div class="form-check"><input class="form-check-input" type="checkbox" value="${value}" id="cb-${value}" ${isChecked}><label class="form-check-label" for="cb-${value}">${name}</label></div>`);
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
    $imageGrid.on('click', '.thumbnail-container', function() {$(this).find('.thumbnail').toggleClass('selected'); updateButtonStates();});
    $(window).on('beforeunload', () => pageIsDirty ? "You have unsaved changes. Are you sure you want to leave?" : undefined);
    $statusText.on('click', showLogModal).css('cursor', 'pointer').attr('title', 'Click to see log');
}

function updateStatus(message, isProcessingUpdate = false) {
    $statusText.text(message);
    // Only add significant, non-spammy messages to the log
    if (!isProcessingUpdate) {
        statusLog.unshift({ time: new Date().toLocaleTimeString(), msg: message });
    }
}

function showLogModal() {
    const $logBody = $('#log-modal-body');
    if (statusLog.length === 0) {
        $logBody.html('<p class="text-muted">No log messages yet.</p>');
    } else {
        const logHTML = statusLog.map(entry => `<p class="mb-1"><span class="badge bg-secondary me-2">${entry.time}</span>${entry.msg}</p>`).join('');
        $logBody.html(logHTML);
    }
    const logModal = new bootstrap.Modal(document.getElementById('log-modal'));
    logModal.show();
}

// --- Image Handling & Failsafes ---
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {alert("Invalid file type. Please select an image that the browser recognizes as a supported image."); return;}
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

function handleFilterSelection(e) {$('#filter-checkboxes input').prop('checked', e.currentTarget.id === 'select-all-filters');}

function handlePopulationChange() {
    if (isProcessing || population.length === 0) return;
    const newSize = parseInt($('#num-images-slider').val());
    const oldSize = population.length;
    const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    
    if (newSize > oldSize) {for (let i = 0; i < newSize - oldSize; i++) {population.push(new Particle(availableFilters));}} 
    else if (newSize < oldSize) {population.sort((a, b) => a.fitness - b.fitness); population = population.slice(0, newSize);}
    $statusText.text(`Population size set to ${newSize}.`);
}

function handleReset(isNewImage = false) {
    if (!isNewImage && !confirm("Are you sure you want to reset? This will clear all history.")) {return;}
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
    await new Promise(resolve => setTimeout(resolve, 50));//creates a delay of 50 milliseconds in an asynchronous function. often used to wait briefly, perhaps for UI updates, asynchronous processes, or to debounce actions.

    const availableFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
    if (availableFilters.length === 0) {alert("Please select at least one filter type to use for evolution.");cancelProcessing(startTime); return;}

    if (isReset) {//reset button was clicked
        globalBest = null;
        const popSize = parseInt($('#num-images-slider').val());
        population = Array.from({ length: popSize }, () => new Particle(availableFilters));
    } else {updatePopulationState(availableFilters);}
    
    history.push({
        population: JSON.parse(JSON.stringify(population)),
        psoParams: {inertia: $('#inertia-slider').val(), cognition: $('#cognition-slider').val(), social: $('#social-slider').val(),},
        previewSize: $('#preview-size-slider').val(),
        availableFilters: availableFilters
    });
    updateHistoryDropdown(history.length);
    await processAndRenderPopulation(population, `Processing Generation ${history.length}`, availableFilters);    
    if (isProcessing) {
        pageIsDirty = true; 
        $statusText.text(`Generation ${history.length} complete. Select your favorites and click 'Evolve'.`);} else {$statusText.text("Processing cancelled by user.");}
    cancelProcessing(startTime);
}

async function processAndRenderPopulation(pop, statusPrefix, filters) {
    const allResults = [];
    $imageGrid.empty().height('auto');
    //let counter = 0;
    
    for (let i = 0; i < pop.length; i++) {
        if (!isProcessing) break;
        const status = `${statusPrefix} (${i + 1}/${pop.length})`;
        $('#processing-status').text(status);
        
        const { resultMat, tooltip } = applyFilterSequence(pop[i].position, filters);
        let canvas = document.createElement('canvas');
        cv.imshow(canvas, resultMat);
        //if (areMatsIdentical(srcMat, resultMat)) {counter = counter + 1;}

        allResults.push({ canvas: canvas, tooltip: tooltip });
        resultMat.delete();
        
        if (i % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (isProcessing) {renderGrid(allResults)}
    //alert(counter);
}

/**
 * Compares two OpenCV matrices by directly comparing their underlying data.
 * This is significantly faster than using OpenCV's difference and countNonZero methods.
 * @param {cv.Mat} mat1 The first matrix.
 * @param {cv.Mat} mat2 The second matrix.
 * @returns {boolean} True if the matrices are identical, false otherwise.
 */
function areMatsIdentical(mat1, mat2) {
    // 1. Check dimensions and type first. This is a very fast check.
    if (mat1.rows !== mat2.rows || mat1.cols !== mat2.cols || mat1.type() !== mat2.type()) {
        return false;
    }
    
    // 2. Get the underlying data arrays.
    const data1 = mat1.data;
    const data2 = mat2.data;

    // 3. Check if the arrays are the same length.
    // This is a redundant check if rows, cols, and type are the same, but good for safety.
    if (data1.length !== data2.length) {
        return false;
    }

    // 4. Compare the elements of the arrays.
    // Use a simple for loop for speed.
    for (let i = 0; i < data1.length; i++) {
        if (data1[i] !== data2[i]) {
            // Found a difference, so they are not identical.
            return false;
        }
    }
    
    // If the loop completes without finding any differences, the matrices are identical.
    return true;
}
// --- Corrected PSO Evolution Logic ---
function updatePopulationState(availableFilters) {//gets values from sliders, selected image indices, reinitializes unselected particles, 
    const psoParams = {
        w: parseFloat($('#inertia-slider').val()),
        c1: parseFloat($('#cognition-slider').val()),
        c2: parseFloat($('#social-slider').val())
    };
    const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();

    //TODO: ADD CONDITION HERE TO CHECK IF FILTER SET WAS CHANGED
    // Re-initialize unselected particles if the filter set has changed. This allows the swarm to adapt to new user constraints.
    population.forEach((p, i) => {
        const isSelected = selectedIndices.includes(i);
        if (!isSelected) {population[i] = new Particle(availableFilters);}
    });

    if (selectedIndices.length > 0) {
        // Calculate fitness for the selected particles
        population.forEach((p, i) => {//Iterates over each individual p in the population array. i is the current index of the individual in the array.        
            const fitness = selectedIndices.indexOf(i);//Checks if the current individual's index i is present in the selectedIndices array.If i is found, fitness is set to its position in selectedIndices (a number ≥ 0). If not found, fitness will be -1.
            p.fitness = (fitness !== -1) ? fitness : Infinity;//If i was found in selectedIndices, set p.fitness to that index value. If not found, assign Infinity (indicating a very poor or invalid fitness).
            if (p.fitness < p.pbest.fitness) {//Checks if the current p.fitness is better (i.e., numerically lower) than the individual's personal best p.pbest.fitness.
                p.pbest.fitness = p.fitness;//If so, updates the individual's personal best fitness to the current fitness.
                p.pbest.position = JSON.parse(JSON.stringify(p.position));//Creates a deep copy of the current position p.position and assigns it to p.pbest.position. Ensures that the personal best position remains unchanged even if p.position is modified later.
            }
        });

        // Find the absolute best particle from the user's selection. Finds the fittest particle in a population of particles, excluding particles with infinite fitness
        const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
        
        // Update the global best if the new best is better
        if (fittestParticle) {
             if (!globalBest || fittestParticle.fitness < globalBest.fitness) {globalBest = JSON.parse(JSON.stringify(fittestParticle));}
        }
    }
    
    if (!globalBest) {$statusText.text("No selection made. Evolving with new random variations.");} // If there's no global best yet (e.g., first "Evolve" with no selection), we can't evolve. Just keep the re-initialized random particles.
    else {population.forEach(p => p.update(globalBest.pbest.position, psoParams));}// Evolve ALL particles (both selected and newly randomized ones) toward the global best
}

// --- Filter Application (Complete, Robust, and Flexible) ---
function applyFilterSequence(position, availableFilters) {
    let tempMat = srcMat.clone();
    let sequence = [];
    const usedFilters = new Set(); // Ensure unique filters per chain

    for (let i = 0; i < MAX_FILTER_CHAIN_LENGTH; i++) {
        // Use named dimensions for readability
        const typeIndex = i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.TYPE;
        const valueIndex = i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.VALUE;
        const activeIndex = i * FILTER_ITEM_SIZE + FILTER_DIMENSIONS.ACTIVE;

        if (position[activeIndex] > 0.5) { // Is this step active?
            const filterNameIndex = Math.floor(position[typeIndex] * availableFilters.length);
            const filterName = availableFilters[filterNameIndex];
            
            if (filterName && !usedFilters.has(filterName)) {
                usedFilters.add(filterName);
                const normalizedValue = position[valueIndex];
                const { min, max } = ALL_FILTERS[filterName];
                
                // --- FIX: Robust Value De-normalization and Clamping ---
                let value = min + (normalizedValue * (max - min));

                // Apply filter-specific constraints to prevent errors and NaN
                switch(filterName) {
                    case INVERT:
                    case SHARPEN:
                        value = value > 0.5 ? 1 : 0; // Force binary
                        break;
                    case BLUR:
                    case MEDIAN:
                    case SOBEL:
                        // Force odd integer for kernel sizes
                        value = Math.round(value);
                        value = Math.floor(value / 2) * 2 + 1;
                        break;
                    case GAMMA:
                        // Prevent division by zero
                        value = Math.max(0.01, value);
                        break;
                }                
                sequence.push({ op: filterName, val: value });
            }
        }
    }

    // Apply the constructed sequence
    sequence.forEach(step => {        
        try {
            switch(step.op) {
                case GAMMA: {
                    const gammaValue = 1.0 / step.val;
                    const lookUpTable = new Uint8Array(256);
                    for (let i = 0; i < 256; i++) {
                        lookUpTable[i] = Math.pow(i / 255.0, gammaValue) * 255;
                    }
                    let lutMat = cv.matFromArray(1, 256, cv.CV_8U, lookUpTable);
                    let dstMat = new cv.Mat();                 
                    cv.LUT(tempMat, lutMat, tempMat);
                    lutMat.delete();
                    break;
                }
                case SHARPEN: {
                    if (step.val === 1) { // Only apply if active
                        let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
                        cv.filter2D(tempMat, tempMat, -1, kernel);
                        kernel.delete();
                    }
                    break;
                }
                case INVERT: {
                    if (step.val === 1) { // Only apply if active
                        cv.bitwise_not(tempMat, tempMat);
                    }
                    break;
                }
                case BRIGHTNESS: tempMat.convertTo(tempMat, -1, 1.0, step.val); break;
                case CONTRAST: tempMat.convertTo(tempMat, -1, step.val, 0); break;       
                case SATURATION: {
                    let hsv = new cv.Mat(); cv.cvtColor(tempMat, hsv, cv.COLOR_RGBA2RGB); cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
                    let planes = new cv.MatVector(); cv.split(hsv, planes); let s = planes.get(1);
                    s.convertTo(s, -1, step.val, 0); cv.merge(planes, hsv);
                    cv.cvtColor(hsv, tempMat, cv.COLOR_HSV2RGB); cv.cvtColor(tempMat, tempMat, cv.COLOR_RGB2RGBA);
                    hsv.delete(); planes.delete(); s.delete(); break;
                }
                case CLAHE: {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    let clahe = cv.createCLAHE(step.val, new cv.Size(8, 8)); clahe.apply(gray, gray);
                    cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0); clahe.delete(); gray.delete(); gray = null; break;
                }
                case BLUR: case 'median': {
                    let ksize = Math.floor(step.val / 2) * 2 + 1;
                    if (step.op === 'blur') cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0);
                    else cv.medianBlur(tempMat, tempMat, ksize); break;
                }
                case DENOISE: cv.fastNlMeansDenoisingColored(tempMat, tempMat, step.val, step.val, 7, 21); break;
                case CANNY: {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    cv.Canny(gray, gray, step.val, step.val * 2); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
                    gray.delete(); gray = null; break;
                }
                case SOBEL: {
                    gray = new cv.Mat(); cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
                    let ksize = Math.floor(step.val / 2) * 2 + 1; let gradX = new cv.Mat(); let gradY = new cv.Mat();
                    cv.Sobel(gray, gradX, cv.CV_8U, 1, 0, ksize); cv.Sobel(gray, gradY, cv.CV_8U, 0, 1, ksize);
                    cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gray); cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
                    gradX.delete(); gradY.delete(); gray.delete(); gray = null; break;
                }
                case ERODE: case 'dilate': {
                    let ksize = Math.floor(step.val); let kernel = cv.Mat.ones(ksize, ksize, cv.CV_8U);
                    if (step.op === 'erode') cv.erode(tempMat, tempMat, kernel); else cv.dilate(tempMat, tempMat, kernel);
                    kernel.delete(); break;
                }
                case THRESHOLD: {
                    cv.cvtColor(tempMat, tempMat, cv.COLOR_RGBA2GRAY);
                    cv.threshold(tempMat, tempMat, step.val, 255, cv.THRESH_BINARY);
                    cv.cvtColor(tempMat, tempMat, cv.COLOR_GRAY2RGBA); break;
                }
            }
        } catch (err) { console.error(`Failed to apply filter ${step.op} with value ${step.val}:`, err); }
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
    const selectedData = selected.map(function() {return { src: $(this).find('img').attr('src'), caption: $(this).attr('data-bs-original-title') };}).get();
    
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

    if (isProcessing) {$('button, input').not('#cancel-processing-btn').prop('disabled', true); return;}
    $('button, input').prop('disabled', false);
    $('#image-upload').prop('disabled', typeof cv === 'undefined' || isProcessing);
    
    if (!imageLoaded) {        
        $('#try-again-btn, #reset-btn, #history-dropdown, #compare-btn, #save-btn').prop('disabled', true);// Disable almost everything if no image is loaded
    } else {
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

init();// Start the application

