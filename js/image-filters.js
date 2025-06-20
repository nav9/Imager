$(document).ready(function() {
    // --- Configuration ---
    const FILTER_PARAMS = {
        brightness: { min: -0.8, max: 0.8 },
        contrast: { min: -0.8, max: 0.8 },
        gamma: { min: 0.2, max: 3.0 },
        hue: { min: -1.0, max: 1.0 },
        saturation: { min: -1.0, max: 1.0 },
        vibrance: { min: -1.0, max: 1.0 },
        sepia: { min: 0.1, max: 1.0 },
        sharpen: { min: 0.1, max: 10.0 },
        unsharpMask: { min: 0, max: 10, radius: 20 }, // radius is fixed for simplicity
        noise: { min: 0.0, max: 0.5 },
        denoise: { min: 1.0, max: 50.0 },
        vignette: { min: 0.1, max: 0.8, size: 0.5 } // size can be fixed
    };

    // --- State Variables ---
    let originalImage = null;
    let canvas, texture;
    let population = [];
    let history = [];
    let currentHistoryIndex = -1;
    let globalBest = null;

    // --- DOM Elements ---
    const $imageUpload = $('#image-upload');
    const $imageUrl = $('#image-url');
    const $loadUrlBtn = $('#load-url-btn');
    const $statusText = $('#status-text');
    const $imageGrid = $('#image-grid');
    const $actionButtons = $('#try-again-btn, #reset-btn, #prev-btn, #next-btn, #compare-btn, #save-btn');
    const compareModal = new bootstrap.Modal(document.getElementById('compare-modal'));

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
        $imageUpload.on('change', handleImageUpload);
        $loadUrlBtn.on('click', handleImageUrl);
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
    }

    // --- Image Handling ---
    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            alert('Invalid file type. Please use JPEG, PNG, or WebP.');
            return;
        }
        if (file.size > 15 * 1024 * 1024) { // 15MB limit
             alert('File is too large (max 15MB).');
             return;
        }
        const reader = new FileReader();
        reader.onload = e => loadImage(e.target.result);
        reader.readAsDataURL(file);
    }

    function handleImageUrl() {
        const url = $imageUrl.val().trim();
        if (!url) return;
        $statusText.text('Loading from URL...').removeClass('text-danger');
        $loadUrlBtn.prop('disabled', true);
        
        // Very basic URL validation
        if (!url.match(/^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i)) {
             $statusText.text('Invalid image URL format.').addClass('text-danger');
             $loadUrlBtn.prop('disabled', false);
             return;
        }
        
        // Use a CORS proxy for robustness
        const proxyUrl = 'https://corsproxy.io/?';
        loadImage(proxyUrl + url);
    }
    
    function loadImage(src) {
        const image = new Image();
        // image.crossOrigin = "Anonymous";
        image.onload = () => {
            try {
                if (!canvas) canvas = fx.canvas();
                originalImage = image;
                texture = canvas.texture(originalImage);
                texture.loadContentsOf(originalImage);
                $statusText.text('Image loaded. Ready to evolve.');
                $loadUrlBtn.prop('disabled', false);
                runEvolution(true); // Start the first generation
            } catch (e) {
                console.error(e);
                alert("Could not initialize WebGL. Your browser may not support it, or the image could be corrupted.");
                 $statusText.text('Error initializing image.').addClass('text-danger');
                 $loadUrlBtn.prop('disabled', false);
            }
        };
        image.onerror = () => {
            $statusText.text('Failed to load image from URL. It may be blocked by CORS or is not a valid image.').addClass('text-danger');
            $loadUrlBtn.prop('disabled', false);
        };
        image.src = src;
    }


    // --- PSO & Evolution Logic ---
    function runEvolution(isReset) {
        if (!originalImage) {
            alert("Please load an image first.");
            return;
        }
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

    // --- Start the App ---
    init();
});