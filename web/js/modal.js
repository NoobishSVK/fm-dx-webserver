$(document).ready(function() {
  var modal = $("#myModal");
  var modalPanel = $(".modal-panel");
  var openBtn = $(".settings");
  var closeBtn = $(".closeModal, .closeModalButton");
  
  initPopups();
  
  openBtn.on("click", function() {
    openModal(modalPanel);
  });
  
  closeBtn.on("click", closeModal);
  
  function openModal(panel) {
    modal.css("display", "block");
    panel.css("display", "block");
    $("body").addClass("modal-open"); // Disable body scrolling
    setTimeout(function() {
      modal.css("opacity", 1);
    }, 10);
  }
  
  function closeModal() {
    modal.css("opacity", 0);
    setTimeout(function() {
      modal.css("display", "none");
      $("body").removeClass("modal-open"); // Enable body scrolling
    }, 300);
  }
  

  $(document).on("click", function(event) { // Close the modal when clicking outside of it
    if ($(event.target).is(modal)) {
      closeModal();
    }
  });
  
  $(document).on("keydown", function(event) { // Close the modal when pressing ESC key
    if (event.key === "Escape") {
      closeModal();
    }
  });

  $(".tuner-mobile-settings").on("click", function () {
    $(".popup-window").fadeOut(200);
    $("#popup-panel-mobile-settings").fadeIn(200);
  });

  $("#data-station-others").on("click", function () {
    $(".popup-window").fadeOut(200);
    $("#popup-panel-transmitters").fadeIn(200);
  });
});

function initPopups() {
  $(".popup-window").draggable({
    handle: ".popup-header",
    containment: "body" 
  }).resizable({
    minHeight: 330,
    minWidth: 350,
    containment: "body"
  });
  
  $(".popup-close").on("click", function () {
    $(".popup-window").fadeOut(200);
  });
}