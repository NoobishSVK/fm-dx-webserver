$(document).ready(function() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const chatSocket = new WebSocket(`${protocol}//${window.location.host}${window.location.pathname}chat`);
    let chatMessageCount = 0;
    const chatMessages = $('#chat-chatbox');
    const chatMessagesCount = $('.chat-messages-count');
    const chatButton = $('.chatbutton');
    const chatSendInput = $('#chat-send-message');
    const chatIdentityNickname = $('#chat-identity-nickname');
    const chatNicknameInput = $('#chat-nickname');
    const chatNicknameSave = $('#chat-nickname-save');
    
    $(".chatbutton").on("click", function () {
        togglePopup("#popup-panel-chat");
        chatMessages.scrollTop(chatMessages[0].scrollHeight);
    });
    
    // Function to generate a random string
    function generateRandomString(length) {
        const characters = 'ABCDEFGHJKMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }
    
    // Load nickname from localStorage on page load
    let savedNickname = localStorage.getItem('nickname') || `User ${generateRandomString(5)}`;
    chatNicknameInput.val(savedNickname);
    chatIdentityNickname.text(savedNickname);
    
    chatSocket.onmessage = function(event) {
        const messageData = JSON.parse(event.data);
        const isAdmin = messageData.admin ? '<span style="color: #bada55">[ADMIN]</span>' : '';
        
        if (messageData.type === 'clientIp') {
            chatIdentityNickname.html(isAdmin).append(document.createTextNode(" " + savedNickname));
            chatIdentityNickname.attr('title', messageData.ip);
        } else {
            const chatMessage = `
                <span class="color-2">[${messageData.time}]</span>
                ${isAdmin} <strong class="color-5" title="${typeof messageData.ip !== "undefined" ? 'IP Address: ' + messageData.ip : ''}">${messageData.nickname}</strong>: 
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
                    chatMessagesCount.attr("aria-label", "Chat (" + chatMessageCount + " unread)");
                    chatButton.removeClass('bg-color-1').addClass('blink');
                }
            }
        }
    };
    
    $('.chat-send-message-btn').click(sendMessage);
    chatNicknameSave.click(function() {
        const currentNickname = chatNicknameInput.val().trim() || `Anonymous User ${generateRandomString(5)}`;
        localStorage.setItem('nickname', currentNickname);
        savedNickname = currentNickname;
        chatIdentityNickname.text(savedNickname);
        chatNicknameInput.blur();
    });
    
    chatButton.click(function() {
        chatMessageCount = 0;
        chatMessagesCount.text(chatMessageCount);
        chatButton.removeClass('blink').addClass('bg-color-1');
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
    
    function sendMessage() {
        const nickname = savedNickname || `Anonymous User ${generateRandomString(5)}`;
        const message = chatSendInput.val().trim();
        
        if (message) {
            const messageData = { nickname, message };
            chatSocket.send(JSON.stringify(messageData));
            chatSendInput.val('');
        }
    }
});
