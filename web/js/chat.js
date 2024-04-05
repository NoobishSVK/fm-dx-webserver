$(document).ready(function() {
  const chatSocket = new WebSocket(`ws://${window.location.host}/chat`);
  let chatMessageCount = 0;
  const chatMessages = $('#chat-chatbox');
  const chatMessagesCount = $('.chat-messages-count');
  const chatButton = $('.chatbutton');
  const chatSendInput = $('#chat-send-message');
  const chatIdentityNickname = $('#chat-identity-nickname');
  const chatNicknameInput = $('#chat-nickname');
  const chatNicknameSave = $('#chat-nickname-save');

  chatSocket.onmessage = function(event) {
      const messageData = JSON.parse(event.data);
      const isAdmin = messageData.admin ? '<span style="color: #bada55">[ADMIN]</span>' : '';
      
      if (messageData.type === 'clientIp') {
          chatIdentityNickname.html(isAdmin + " " + (savedNickname.length > 0 ? savedNickname : 'Anonymous User'));
          chatIdentityNickname.attr('title', messageData.ip);
      } else {
          const chatMessage = `
              <span class="color-2">[${messageData.time}]</span>
              ${isAdmin} <strong class="color-5" title="IP Address: ${messageData.ip}">${messageData.nickname}</strong>: 
              <span style="color: var(--color-text-2);">${$('<div/>').text(messageData.message).html()}</span><br>
          `;
          chatMessages.append(chatMessage);

          if (chatMessages.is(':visible')) {
              setTimeout(function() {
                  chatMessages.scrollTop(chatMessages[0].scrollHeight);
              }, 100);
          } else {
              if (!messageData.history) {
                  chatMessageCount++;
                  chatMessagesCount.text(chatMessageCount);
                  chatButton.removeClass('bg-color-2').addClass('bg-color-4');
              }
          }
      }
  };

  $('.chat-send-message-btn').click(sendMessage);
  chatNicknameSave.click(function() {
      const currentNickname = chatNicknameInput.val();
      localStorage.setItem('nickname', currentNickname);
      chatIdentityNickname.text(currentNickname.length > 0 ? currentNickname : 'Anonymous User');
      chatNicknameInput.blur();
  });
  
  chatButton.click(function() {
      chatMessageCount = 0;
      chatMessagesCount.text(chatMessageCount);
      chatButton.removeClass('bg-color-4').addClass('bg-color-2');
      chatSendInput.focus();

      setTimeout(function() {
          chatMessages.scrollTop(chatMessages[0].scrollHeight);
      }, 100);
  });

  chatNicknameInput.keypress(function(event) {
      if (event.which === 13) {
          chatNicknameSave.trigger('click');
      }
  });

  chatSendInput.keypress(function(event) {
      if (event.which === 13) {
          sendMessage();
      }
  });

  // Load nickname from localStorage on page load
  const savedNickname = localStorage.getItem('nickname');
  if (savedNickname) {
      chatNicknameInput.val(savedNickname);
  }

  function sendMessage() {
    const nickname = savedNickname || 'Anonymous user';
    const message = chatSendInput.val().trim();
  
    if (message) {
        const messageData = { nickname, message };
        chatSocket.send(JSON.stringify(messageData));
        chatSendInput.val('');
    }
  }
});