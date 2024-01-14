// Get the modal element and the buttons to open and close it
var modal = document.getElementById("myModal");
var openBtn = document.getElementById("settings");
var closeBtn = document.getElementById("closeModal");
var closeBtnFull = document.getElementById("closeModalButton");

// Function to open the modal
function openModal() {
  modal.style.display = "block";
  setTimeout(function() {
    modal.style.opacity = 1;
  }, 10);
}

// Function to close the modal
function closeModal() {
  modal.style.opacity = 0;
  setTimeout(function() {
    modal.style.display = "none";
  }, 300); // This delay should match the transition duration (0.3s).
}

// Event listeners for the open and close buttons
openBtn.addEventListener("click", openModal);
closeBtn.addEventListener("click", closeModal);
closeBtnFull.addEventListener("click", closeModal);

// Close the modal when clicking outside of it
window.addEventListener("click", function(event) {
  if (event.target == modal) {
    closeModal();
  }
});