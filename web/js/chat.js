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
    
    let amAdmin = false;

    chatSocket.onmessage = function(event) {
        const messageData = JSON.parse(event.data);
        const isAdmin = messageData.admin ? '<span style="color: #bada55">[ADMIN]</span>' : '';

        if (messageData.type === 'clientIp') {
            amAdmin = messageData.admin === true;
            $('#chat-clear').toggle(amAdmin).next('.popup-close').css('margin-left', amAdmin ? 0 : '');
            chatIdentityNickname.html(isAdmin).append(document.createTextNode(" " + savedNickname));
            chatIdentityNickname.attr('title', messageData.ip);
        } else if (messageData.type === 'clear') {
            chatMessages.empty();
        } else if (messageData.type === 'delete') {
            chatMessages.children(`[data-id="${Number(messageData.id)}"]`).remove();
        } else {
            const deleteButton = amAdmin ? `<button class="chat-delete" aria-label="Delete message" style="background: none; width: auto; height: auto; padding: 0 5px; color: var(--color-text-2);"><i class="fa-solid fa-trash"></i></button>` : '';
            const chatMessage = `
                <div data-id="${Number(messageData.id)}">
                ${deleteButton}<span class="color-2">[${messageData.time}]</span>
                ${isAdmin} <strong class="color-5" title="${typeof messageData.ip !== "undefined" ? 'IP Address: ' + messageData.ip : ''}">${messageData.nickname}</strong>:
                <span style="color: var(--color-text-2);">${$('<div/>').text(messageData.message).html()}</span>
                </div>
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

    $('#chat-clear').click(function() {
        if (confirm('Clear the whole chat history for everyone?')) {
            chatSocket.send(JSON.stringify({ type: 'clear' }));
        }
    });

    chatMessages.on('click', '.chat-delete', function() {
        chatSocket.send(JSON.stringify({ type: 'delete', id: Number($(this).parent().data('id')) }));
    });
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
