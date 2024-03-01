$(document).ready(function() {
  // Cache jQuery objects for reuse
  var modal = $("#myModal");
  var modalPanel = $(".modal-panel");
  var chatPanel = $(".modal-panel-chat");
  var chatOpenBtn = $(".chatbutton");
  var openBtn = $("#settings");
  var closeBtn = $(".closeModal, .closeModalButton");

  // Function to open the modal
  function openModal() {
    modal.css("display", "block");
    modalPanel.css("display", "block");
    setTimeout(function() {
      modal.css("opacity", 1);
    }, 10);
  }

  function openChat() {
    modal.css("display", "block");
    chatPanel.css("display", "block");
    setTimeout(function() {
      modal.css("opacity", 1);
    }, 10);
  }


// Function to close the modal
function closeModal() {
  modal.css("opacity", 0);
  setTimeout(function() {
    modal.css("display", "none");
    modalPanel.css("display", "none");
    chatPanel.css("display", "none");
  }, 300);
}

// Event listeners for the open and close buttons
openBtn.on("click", openModal);
chatOpenBtn.on("click", openChat);
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