$(document).ready(function() {
    if($('.step:visible').index() == 0) {
        $('.btn-prev').hide();
    } 

    $('.btn-next').click(function() {
        var currentStep = $('.step:visible');
        var nextStep = currentStep.next('.step');

        if (nextStep.length !== 0) {
            currentStep.hide();
            nextStep.show();
            updateProgressBar(nextStep);
        } else {
            submitData();
        }

        updateWizardContent();
    });

    $('.btn-prev').click(function() {
        var currentStep = $('.step:visible');
        var nextStep = currentStep.prev('.step');

        if (nextStep.length !== 0) {
            currentStep.hide();
            nextStep.show();
            updateProgressBar(nextStep);
        } else {
            alert('You have reached the beginning of the wizard.');
        }

        updateWizardContent();
    });
});

// Function to update the progress bar buttons
function updateProgressBar(currentStep) {
    var stepIndex = $('.step').index(currentStep) + 1;
    $('.btn-rounded-cube').removeClass('activated');
    $('.btn-rounded-cube:lt(' + stepIndex + ')').addClass('activated');
}

function updateWizardContent() {
    if($('.step:visible').index() == 0) {
        $('.btn-prev').hide();
    } else {
        $('.btn-prev').show();
    }

    if($('.step:visible').index() == 3) {
        setTimeout(function () {
            map.invalidateSize();
        }, 200);
    }
    
    if($('.step:visible').index() == 4) {
        $('.btn-next').text('Save');
    } else {
        $('.btn-next').text('Next')
    }
}