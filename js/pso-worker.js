// js/pso-worker.js

// Load OpenCV.js in the worker scope
self.importScripts('opencv.js');

// --- PSO & Filter Configuration ---
const FILTER_PARAMS = {
    brightness: { min: -100, max: 100 },
    contrast: { min: 1.0, max: 3.0 },
    gamma: { min: 0.2, max: 3.0 },
    saturation: { min: 0.0, max: 3.0 },
    invert: { min: 0, max: 1 },
    threshold: { min: 50, max: 200 },
    clahe: { min: 1.0, max: 10.0, gridSize: 8 },
    sharpen: { min: 0, max: 1 },
    blur: { min: 1, max: 15 },
    median: { min: 3, max: 15 },
    denoise: { min: 1, max: 21 },
    canny: { min: 20, max: 100 },
    sobel: { min: 1, max: 5 },
    erode: { min: 1, max: 9 },
    dilate: { min: 1, max: 9 },
};

// --- Particle Class ---
class Particle {
    // ... (Particle class from previous response, no changes needed) ...
}


// --- Main Worker Logic ---
self.onmessage = (e) => {
    const { imageData, populationState, psoParams, selectedFilters, isReset, selectedIndices } = e.data;

    // Wait for OpenCV to be ready
    cv['onRuntimeInitialized'] = () => {
        try {
            const srcMat = cv.matFromImageData(imageData);
            let population = initializePopulation(populationState, selectedFilters, isReset);
            
            if (!isReset) {
                population = updatePopulation(population, psoParams, selectedIndices);
            }

            let results = [];
            for (let i = 0; i < population.length; i++) {
                const particle = population[i];
                const resultMat = applyAllFilters(srcMat, particle.position);
                const resultImageData = new ImageData(new Uint8ClampedArray(resultMat.data), resultMat.cols, resultMat.rows);
                
                results.push({
                    imageData: resultImageData,
                    tooltip: createTooltip(particle.position)
                });
                resultMat.delete();

                // Send progress update
                self.postMessage({ type: 'progress', data: { status: `Processing variant ${i + 1} of ${population.length}...` } });
            }
            
            // Send final result
            self.postMessage({ type: 'result', data: { results: results, population: population } });

            srcMat.delete();
        } catch(error) {
            self.postMessage({ type: 'error', data: error.toString() });
        }
    };
};

// --- Helper Functions in Worker ---

function initializePopulation(populationState, filters, isReset) {
    if (isReset || !populationState || populationState.length === 0) {
        const popSize = populationState.length || 20; // Default if empty
        return Array.from({ length: popSize }, () => createRandomParticle(filters));
    }
    return populationState;
}

function createRandomParticle(filters) {
    // ... (logic to create a particle with random task queue and values)
}

function updatePopulation(population, psoParams, selectedIndices) {
    // ... (Implement the core PSO update equations for velocity and position)
    // Same logic as before: calculate fitness, find pbest/gbest, update particles
    return population;
}

function applyAllFilters(srcMat, position) {
    let tempMat = srcMat.clone();
    // This function must contain all the cv.xxx calls based on the 'position' object
    // Example for a few filters:
    
    // Brightness/Contrast
    if (position.brightness || position.contrast) {
        tempMat.convertTo(tempMat, -1, position.contrast || 1.0, position.brightness || 0);
    }
    
    // CLAHE
    if (position.clahe) {
        let gray = new cv.Mat();
        cv.cvtColor(tempMat, gray, cv.COLOR_RGBA2GRAY, 0);
        let clahe = cv.createCLAHE(position.clahe, new cv.Size(8, 8));
        clahe.apply(gray, gray);
        cv.cvtColor(gray, tempMat, cv.COLOR_GRAY2RGBA, 0);
        gray.delete();
        clahe.delete();
    }
    
    // Gaussian Blur
    if (position.blur) {
        let ksize = Math.floor(position.blur / 2) * 2 + 1; // Ensure it's odd
        let anchor = new cv.Point(-1, -1);
        cv.GaussianBlur(tempMat, tempMat, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
    }
    
    // ... and so on for all other filters ...
    
    return tempMat;
}

function createTooltip(position) {
    return Object.entries(position)
        .map(([filter, value]) => `${filter}: ${value.toFixed(2)}`)
        .join('\n');
}