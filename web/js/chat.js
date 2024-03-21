var chatUrl = new URL('chat', window.location.href);
chatUrl.protocol = chatUrl.protocol.replace('http', 'ws');
var chatSocketAddress = chatUrl.href;
var chatSocket = new WebSocket(chatSocketAddress);
let chatMessageCount = 0;

$(document).ready(function() {
  chatSocket.onopen = function() {
  };

  chatSocket.onmessage = function(event) {
    var messages = $('#chat-chatbox');
    let messageData = JSON.parse(event.data); // Parse event.data to access its properties
  
    let isAdmin = messageData.admin ? '<span style="color: lime">[ADMIN]</span>' : ''; // Add '[ADMIN] ' if messageData.admin is true, otherwise empty string
    // Check if the message type is 'clientIp'
    if (messageData.type === 'clientIp') {
      // Fill the client IP into the element with ID #chat-ip
      $('#chat-admin').html(isAdmin);
      $('#chat-identity-nickname').attr('title', messageData.ip)
    } else {
        let chatMessage = `
        <span class="color-2">[${messageData.time}]</span>
        ${isAdmin} <strong class="color-5" title="IP Address: ${messageData.ip}">${messageData.nickname}</strong>: <span style="color: var(--color-text-2);">${$('<div/>').text(messageData.message).html()}</span><br>
      `;   
      
      messages.append(chatMessage);
  
      if($('#chat-chatbox').is(':visible')) { 
        setTimeout(function() {
          $('#chat-chatbox').scrollTop($('#chat-chatbox')[0].scrollHeight);
        }, 100)
      } else {
          if(messageData.history !== true) {
              chatMessageCount++;
              $('.chat-messages-count').text(chatMessageCount);
              $('.chatbutton').removeClass('bg-color-2').addClass('bg-color-4');
          }
      }
    }
  };  

  $('.chat-send-message-btn').click(function() {
    sendMessage();
  });

  $('#chat-nickname-save').click(function() {
    let currentNickname = $('#chat-nickname').val();
    localStorage.setItem('nickname', currentNickname);
    $('#chat-identity-nickname').text(localStorage.getItem('nickname'));
    $('#chat-nickname').blur();
  });

  $('.chatbutton').click(function() {
    chatMessageCount = 0;
    $('.chat-messages-count').text(chatMessageCount);
    $('.chatbutton').removeClass('bg-color-4').addClass('bg-color-2');
    $('#chat-send-message').focus();

    setTimeout(function() {
      $('#chat-chatbox').scrollTop($('#chat-chatbox')[0].scrollHeight);
    }, 100)
  });

  $('#chat-nickname').keypress(function(event) {
    if (event.which == 13) { // 13 is the keycode for Enter key
        $('#chat-nickname-save').trigger('click');
    }
  });

  $('#chat-send-message').keypress(function(event) {
    if (event.which == 13) { // 13 is the keycode for Enter key
        sendMessage();
    }
  });

  if(localStorage.getItem('nickname')) {
    $('#chat-nickname').val(localStorage.getItem('nickname'));
    $('#chat-identity-nickname').text(localStorage.getItem('nickname'));
  }

});

function sendMessage() {
    var input = $('#chat-send-message');
    var nickname = localStorage.getItem('nickname');
    if (nickname && nickname.length > 1) {
        // Only assign the nickname if it exists in localStorage and is longer than one character
        nickname = nickname;
    } else {
        // Otherwise, use the default nickname
        nickname = 'Anonymous user';
    }
    
  
    if (input.val().trim() !== '') {
      var messageData = {
        nickname: nickname,
        message: input.val()
      };
  
      chatSocket.send(JSON.stringify(messageData));
      input.val('');
    }
  }  