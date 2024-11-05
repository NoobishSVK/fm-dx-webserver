$(document).ready(function() {
    $('.btn-prev').toggle($('.step:visible').index() !== 0);
    $('.btn-next').click(() => navigateStep(true));
    $('.btn-prev').click(() => navigateStep(false));    
});

function updateProgressBar(currentStep) {
    var stepIndex = $('.step').index(currentStep) + 1;
    $('.btn-rounded-cube').removeClass('activated');
    $('.btn-rounded-cube:lt(' + stepIndex + ')').addClass('activated');
}

function updateWizardContent() {
    var visibleStepIndex = $('.step:visible').index();

    $('.btn-prev').toggle(visibleStepIndex !== 0);
    $('.btn-next').text(visibleStepIndex === 4 ? 'Save' : 'Next');

    visibleStepIndex === 3 && mapReload();
}

function navigateStep(isNext) {
    var currentStep = $('.step:visible');
    var targetStep = isNext ? currentStep.next('.step') : currentStep.prev('.step');
    
    if (targetStep.length !== 0) {
        currentStep.hide();
        targetStep.show();
        updateProgressBar(targetStep);
    } else if (isNext) {
        submitData();
    }
    updateWizardContent();
}