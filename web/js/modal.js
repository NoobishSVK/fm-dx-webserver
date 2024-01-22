$(document).ready(function() {
  // Cache jQuery objects for reuse
  var modal = $("#myModal");
  var openBtn = $("#settings");
  var closeBtn = $("#closeModal, #closeModalButton");

  // Function to open the modal
  function openModal() {
    modal.css("display", "block");
    setTimeout(function() {
      modal.css("opacity", 1);
    }, 10);
  }

  // Function to close the modal
  function closeModal() {
    modal.css("opacity", 0);
    setTimeout(function() {
      modal.css("display", "none");
    }, 300);
  }

  // Event listeners for the open and close buttons
  openBtn.on("click", openModal);
  closeBtn.on("click", closeModal);

  // Close the modal when clicking outside of it
  $(document).on("click", function(event) {
    if ($(event.target).is(modal)) {
      closeModal();
    }
  });
});