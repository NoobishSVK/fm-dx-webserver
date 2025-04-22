$(document).ready(function() {
  // Cache jQuery objects for reuse
  var modal = $("#myModal");
  var modalPanel = $(".modal-panel");
  var openBtn = $("#settings");
  var closeBtn = $(".closeModal, .closeModalButton");

  // Function to open the modal
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

  // Event listeners for the open and close buttons
  openBtn.on("click", function() {
    openModal(modalPanel);
  });

  closeBtn.on("click", closeModal);

  // Close the modal when clicking outside of it
  $(document).on("click", function(event) {
    if ($(event.target).is(modal)) {
      closeModal();
    }
  });

  // Close the modal when pressing ESC key
  $(document).on("keydown", function(event) {
    if (event.key === "Escape") {
      closeModal();
    }
  });
});