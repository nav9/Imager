$(document).ready(function() {
    // --- Configuration for OpenCV Filters ---
    const FILTER_PARAMS = {
        brightness: { min: -100, max: 100 }, // alpha is contrast, beta is brightness
        contrast: { min: 1.0, max: 3.0 },
        gamma: { min: 0.2, max: 3.0 },
        saturation: { min: 0.0, max: 3.0 }, // Multiplier in HSV space
        invert: { min: 0, max: 1 }, // Binary choice
        threshold: { min: 50, max: 200 },
        clahe: { min: 1.0, max: 10.0 }, // Clip limit
        sharpen: { min: 0, max: 1 }, // Binary choice
        blur: { min: 1, max: 15 }, // Kernel size (must be odd)
        median: { min: 3, max: 15 }, // Kernel size (must be odd)
        denoise: { min: 1, max: 21 }, // h value
        canny: { min: 20, max: 100 }, // threshold1
        sobel: { min: 1, max: 5 }, // ksize (must be odd)
        erode: { min: 1, max: 9 }, // kernel size
        dilate: { min: 1, max: 9 }, // kernel size
    };

    // --- State Variables ---
    let originalImage = null;
    let srcMat; // OpenCV matrix for the original image
    let population = [];
    let history = [];
    let currentHistoryIndex = -1;
    let globalBest = null;
    let isProcessing = false;
    let pageIsDirty = false;
    let timerInterval;
    let generationTimes = [];

    // --- DOM Elements ---
    const $statusText = $('#status-text');
    const $imageGrid = $('#image-grid');
    const $overlay = $('#processing-overlay');
    const $imageUpload = $('#image-upload');
    const $imageUrl = $('#image-url');
    const $loadUrlBtn = $('#load-url-btn');
    const $actionButtons = $('#try-again-btn, #reset-btn, #prev-btn, #next-btn, #compare-btn, #save-btn');
    const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

    // --- OpenCV Initialization ---
    $('#opencv-script').on('load', () => {
        if (cv.getBuildInformation) {
            console.log("OpenCV.js is ready.");
            $statusText.text("Ready. Please load an image to begin.");
        } else {
            // Fallback for some browsers
            cv['onRuntimeInitialized'] = () => {
                console.log("OpenCV.js is ready (onRuntimeInitialized).");
                $statusText.text("Ready. Please load an image to begin.");
            };
        }
    });
        
    // --- Particle Class ---
    class Particle {
        constructor(filters) {
            this.position = {}; // { filterName: value, ... }
            this.velocity = {};
            this.pbest = { position: {}, fitness: Infinity };

            filters.forEach(filter => {
                const params = FILTER_PARAMS[filter];
                this.position[filter] = Math.random() * (params.max - params.min) + params.min;
                this.velocity[filter] = (Math.random() * (params.max - params.min) + params.min) * 0.1;
            });
            this.fitness = Infinity; // Higher is worse
        }

        update(gbestPosition) {
            const w = parseFloat($('#inertia-slider').val()); // Inertia
            const c1 = parseFloat($('#cognition-slider').val()); // Cognition
            const c2 = parseFloat($('#social-slider').val()); // Social

            for (const filter in this.position) {
                const r1 = Math.random();
                const r2 = Math.random();

                // Update velocity
                this.velocity[filter] = w * this.velocity[filter]
                    + c1 * r1 * (this.pbest.position[filter] - this.position[filter])
                    + c2 * r2 * (gbestPosition[filter] - this.position[filter]);
                
                // Update position
                this.position[filter] += this.velocity[filter];

                // Clamp position to valid range
                const { min, max } = FILTER_PARAMS[filter];
                if (this.position[filter] > max) this.position[filter] = max;
                if (this.position[filter] < min) this.position[filter] = min;
            }
        }
    }


    // --- Initialization ---
    function init() {
        // Event Handlers for sliders
        ['#num-images-slider', '#preview-size-slider', '#inertia-slider', '#cognition-slider', '#social-slider'].forEach(id => {
            $(id).on('input', e => $(`${id}-value`).text($(e.currentTarget).val()));
        });
        
        $('#preview-size-slider').on('input', () => {
             const size = $('#preview-size-slider').val();
             $('.thumbnail').css({ 'width': size + 'px', 'height': size + 'px' });
        });

        // Event Handlers for buttons
        // Controls
        $('#image-upload').on('change', handleImageUpload);
        $('#select-all-filters').on('click', () => $('#filter-checkboxes input').prop('checked', true));
        $('#select-none-filters').on('click', () => $('#filter-checkboxes input').prop('checked', false));

        //$imageUpload.on('change', handleImageUpload);
        //$loadUrlBtn.on('click', handleImageUrl);
        $('#try-again-btn').on('click', () => runEvolution(false));
        $('#reset-btn').on('click', () => runEvolution(true));
        $('#prev-btn').on('click', navigateHistory(-1));
        $('#next-btn').on('click', navigateHistory(1));
        $('#compare-btn').on('click', showCompareModal);
        $('#save-btn').on('click', saveSelectedImages);

        // Thumbnail selection
        $imageGrid.on('click', '.thumbnail-container', function() {
            $(this).find('.thumbnail').toggleClass('selected');
            updateActionButtons();
        });
        // Unload warning
        $(window).on('beforeunload', function() {
            if (pageIsDirty) {
                return "You have unsaved changes. Are you sure you want to leave?";
            }
        });        
    }

    // --- Image Handling ---
    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => loadImage(e.target.result);
        reader.readAsDataURL(file);
    }

    // function handleImageUrl() {
    //     const url = $imageUrl.val().trim();
    //     if (!url) return;
    //     $statusText.text('Loading from URL...').removeClass('text-danger');
    //     $loadUrlBtn.prop('disabled', true);
        
    //     // Very basic URL validation
    //     if (!url.match(/^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i)) {
    //          $statusText.text('Invalid image URL format.').addClass('text-danger');
    //          $loadUrlBtn.prop('disabled', false);
    //          return;
    //     }
        
    //     // Use a CORS proxy for robustness
    //     const proxyUrl = 'https://corsproxy.io/?';
    //     loadImage(proxyUrl + url);
    // }
    
    function loadImage(src) {
        const image = new Image();
        image.onload = () => {
            originalImage = image;
            if (srcMat) srcMat.delete(); // Clean up previous matrix
            srcMat = cv.imread(originalImage);
            pageIsDirty = true;
            runEvolution(true); // Start the first generation
        };
        image.src = src;
    }


    // --- PSO & Evolution Logic ---
    async function runEvolution(isReset) {
        if (!originalImage || isProcessing) return;
        isProcessing = true;
        showOverlay("Initializing...", "0.0s", "calculating...");
        const startTime = performance.now();
        startTimer(startTime);        
        await yieldToMainThread(); // Let overlay render
        $statusText.text(`Evolving generation ${currentHistoryIndex + 2}...`);        
        
        const selectedFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
        if (selectedFilters.length === 0) {
            $statusText.text("Select at least one filter to apply.");
            return;
        }

        if (isReset) {
            history = [];
            currentHistoryIndex = -1;
            globalBest = null;
            initializePopulation(selectedFilters);
        } else {
            updatePopulation();
        }

        // Save state to history, but trim future states if we've gone back in time
        if(currentHistoryIndex < history.length -1) {
            history = history.slice(0, currentHistoryIndex + 1);
        }
        history.push(JSON.parse(JSON.stringify(population)));
        currentHistoryIndex++;

        renderGrid();
        updateActionButtons();
        $statusText.text(`Generation ${currentHistoryIndex + 1}. Select the best images and click 'Try Again'.`);

        stopTimer(startTime);
        hideOverlay();
        isProcessing = false;        
    }
    
    function initializePopulation(filters) {
        const popSize = parseInt($('#num-images-slider').val());
        population = Array.from({ length: popSize }, () => new Particle(filters));
    }

    function updatePopulation() {
        // Determine fitness and find personal bests
        const selectedIndices = $('.thumbnail.selected').map((_, el) => $(el).data('index')).get();
        
        population.forEach((particle, index) => {
            // Lower index in selection = better fitness
            const fitness = selectedIndices.indexOf(index);
            if(fitness !== -1) { // This particle was selected
                particle.fitness = fitness;
            } else { // Not selected, give worst fitness
                particle.fitness = Infinity;
            }
            
            if (particle.fitness < particle.pbest.fitness) {
                particle.pbest.fitness = particle.fitness;
                particle.pbest.position = { ...particle.position };
            }
        });

        // Find global best from this generation's selections
        const fittestParticle = population.filter(p => p.fitness !== Infinity).sort((a, b) => a.fitness - b.fitness)[0];
        
        if(fittestParticle && (!globalBest || fittestParticle.fitness < globalBest.fitness)) {
            globalBest = { ...fittestParticle };
        }
        
        if (!globalBest) { // If nothing was selected, reshuffle everything
             $statusText.text("Nothing selected, re-shuffling population...");
             const selectedFilters = $('#filter-checkboxes input:checked').map((_, el) => el.value).get();
             initializePopulation(selectedFilters);
             return;
        }
        
        // Update all particles based on global best
        population.forEach(particle => {
            particle.update(globalBest.pbest.position);
        });
    }

    // --- Rendering & UI ---
    function renderGrid() {
        $imageGrid.empty();
        if (currentHistoryIndex < 0) return;

        const currentPopulation = history[currentHistoryIndex];
        const previewSize = $('#preview-size-slider').val();

        currentPopulation.forEach((particle, index) => {
            const tempCanvas = applyFilters(particle.position);
            const tooltipText = Object.entries(particle.position)
                .map(([filter, value]) => `${filter}: ${value.toFixed(2)}`)
                .join('\n');
            
            const container = `
                <div class="thumbnail-container" data-bs-toggle="tooltip" data-bs-placement="top" title="${tooltipText}">
                    <img src="${tempCanvas.toDataURL('image/webp', 0.8)}" 
                         class="thumbnail" 
                         data-index="${index}"
                         style="width:${previewSize}px; height:${previewSize}px; object-fit: cover;">
                </div>
            `;
            $imageGrid.append(container);
        });
        // Re-initialize tooltips
        $('[data-bs-toggle="tooltip"]').tooltip({ boundary: 'window' });
    }

    function applyFilters(position) {
        texture.loadContentsOf(originalImage); // Always start from original
        let chain = canvas.draw(texture);
        
        // Apply filters in a consistent order for predictability
        const filterOrder = Object.keys(FILTER_PARAMS);
        filterOrder.forEach(filter => {
            if(position.hasOwnProperty(filter)) {
                 if (filter === 'unsharpMask') {
                    chain = chain.unsharpMask(FILTER_PARAMS.unsharpMask.radius, position[filter]);
                } else if (filter === 'vignette'){
                    chain = chain.vignette(FILTER_PARAMS.vignette.size, position[filter]);
                } else if(typeof chain[filter] === 'function') {
                    chain = chain[filter](position[filter]);
                }
            }
        });

        chain.update();
        return canvas;
    }

    // --- OpenCV Filter Application ---
    function applyAllFilters(position) {
        let tempMat = srcMat.clone();
        
        // --- IMPORTANT: Filters must be applied in a logical order ---
        // For example: denoise first, then color/contrast, then sharpen
        
        // Pre-processing
        if (position.denoise) { /* ... cv.fastNlMeansDenoisingColored ... */ }
        if (position.blur) { /* ... cv.GaussianBlur ... */ }
        if (position.median) { /* ... cv.medianBlur ... */ }
        
        // Color & Contrast
        if (position.brightness || position.contrast) {
            tempMat.convertTo(tempMat, -1, position.contrast || 1.0, position.brightness || 0);
        }
        if (position.clahe) { /* ... cv.createCLAHE, clahe.apply ... */ }
        if (position.saturation) { /* ... cv.cvtColor(tempMat, hsv, cv.COLOR_RGB2HSV); ... process ... cv.cvtColor back */ }
        
        // Post-processing
        if (position.sharpen) {
             let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
             cv.filter2D(tempMat, tempMat, cv.CV_8U, kernel);
             kernel.delete();
        }
        // ... etc for all other filters ...
        
        return tempMat;
    }
        
    
    function navigateHistory(direction) {
        return () => {
            if (direction === 1 && currentHistoryIndex < history.length - 1) {
                currentHistoryIndex++;
            } else if (direction === -1 && currentHistoryIndex > 0) {
                currentHistoryIndex--;
            }
            renderGrid();
            updateActionButtons();
            $statusText.text(`Viewing Generation ${currentHistoryIndex + 1}.`);
        };
    }

    function updateActionButtons() {
        const hasImage = !!originalImage;
        $actionButtons.prop('disabled', !hasImage);
        
        if (hasImage) {
            const anySelected = $('.thumbnail.selected').length > 0;
            $('#compare-btn, #save-btn').prop('disabled', !anySelected);
            $('#prev-btn').prop('disabled', currentHistoryIndex <= 0);
            $('#next-btn').prop('disabled', currentHistoryIndex >= history.length - 1);
        }
    }

    function showCompareModal() {
        const $modalArea = $('#modal-content-area');
        $modalArea.empty();

        // Add Original
        $modalArea.append(`
            <div class="col-md-4 text-center">
                <img src="${originalImage.src}" class="img-fluid rounded">
                <figcaption class="figure-caption mt-1">Original</figcaption>
            </div>
        `);
        
        // Add Selected
        $('.thumbnail.selected').each(function() {
            const index = $(this).data('index');
            const particle = history[currentHistoryIndex][index];
            const caption = Object.entries(particle.position).map(([k,v]) => `${k}:${v.toFixed(2)}`).join(', ');

            $modalArea.append(`
                <div class="col-md-4 text-center">
                    <img src="${$(this).attr('src')}" class="img-fluid rounded">
                    <figcaption class="figure-caption mt-1">${caption}</figcaption>
                </div>
            `);
        });
        
        compareModal.show();
    }

    async function saveSelectedImages() {
        $statusText.text("Preparing images for download...");
        const zip = new JSZip();
        const dateTime = new Date().toISOString().replace(/[:.]/g, '-');
        const folderName = `Imager-Evo-${currentHistoryIndex + 1}-${dateTime}`;
        const imgFolder = zip.folder(folderName);
        let manifest = "";

        const promises = [];
        $('.thumbnail.selected').each(function(i) {
            const index = $(this).data('index');
            const particle = history[currentHistoryIndex][index];
            const imageName = `image-${i + 1}.png`;
            manifest += `${imageName}\n` +
                        `--------------------\n` +
                        Object.entries(particle.position)
                              .map(([filter, value]) => `${filter}: ${value.toFixed(3)}`)
                              .join('\n') +
                        `\n\n`;

            const dataUrl = $(this).attr('src');
            promises.push(
                fetch(dataUrl)
                .then(res => res.blob())
                .then(blob => imgFolder.file(imageName, blob))
            );
        });

        await Promise.all(promises);
        imgFolder.file("manifest.txt", manifest);

        zip.generateAsync({ type: "blob" }).then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${folderName}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            $statusText.text("Download complete.");
        });
    }

    // --- UI Helpers & Timers ---
    function showOverlay(status, time, eta) {
        $('#processing-status').text(status);
        $('#processing-timer').text(`Time elapsed: ${time}`);
        $('#processing-eta').text(`ETA: ${eta}`);
        $overlay.removeClass('d-none');
    }

    function hideOverlay() { $overlay.addClass('d-none'); }
    
    function updateOverlayStatus(status) { $('#processing-status').text(status); }

    function startTimer(startTime) {
        timerInterval = setInterval(() => {
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            $('#processing-timer').text(`Time elapsed: ${elapsed}s`);
        }, 100);
    }
    
    function stopTimer(startTime) {
        clearInterval(timerInterval);
        const totalTime = (performance.now() - startTime) / 1000;
        generationTimes.push(totalTime);
        // ... (calculate and display ETA for next run)
    }

    async function yieldToMainThread() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }    

    // --- Start the App ---
    init();
});